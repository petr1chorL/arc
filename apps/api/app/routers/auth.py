from collections.abc import Callable
from datetime import datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import AuditActor, AuditService
from app.auth import (
    AccountLocked,
    AuthenticationError,
    AuthenticationConfigurationError,
    AuthenticationService,
    CsrfError,
    PasswordChangeError,
    aware_utc,
)
from app.config import Settings
from app.models import (
    InvitationRecord,
    SessionRecord,
    UserRecord,
    WorkspaceMembershipRecord,
    WorkspaceRecord,
)
from app.schemas import (
    AuthSessionRead,
    ChangePasswordCreate,
    InvitationActivateCreate,
    InvitationPreviewRead,
    LoginCreate,
)


class SessionAuthenticationError(Exception):
    pass


def clear_auth_cookies(
    response: Response,
    settings: Settings,
) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(
        settings.csrf_cookie_name,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def build_session_auth_error_handler(
    settings: Settings,
) -> Callable[[Request, SessionAuthenticationError], JSONResponse]:
    async def handler(
        _request: Request,
        exc: SessionAuthenticationError,
    ) -> JSONResponse:
        response = JSONResponse(
            status_code=401,
            content={"detail": str(exc)},
        )
        clear_auth_cookies(response, settings)
        return response

    return handler


def create_auth_router(
    get_session: Callable,
    service: AuthenticationService,
    settings: Settings,
) -> APIRouter:
    router = APIRouter(tags=["auth"])
    audit_service = AuditService()
    invitation_rate_limits: dict[tuple[str, str, str], tuple[int, datetime]] = {}
    invitation_rate_limit_max = 20
    invitation_rate_limit_window = timedelta(hours=1)

    def set_auth_cookies(
        response: Response,
        session_token: str,
        csrf_token: str,
    ) -> None:
        max_age = settings.session_absolute_days * 24 * 60 * 60
        response.set_cookie(
            settings.session_cookie_name,
            session_token,
            max_age=max_age,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
        )
        response.set_cookie(
            settings.csrf_cookie_name,
            csrf_token,
            max_age=max_age,
            httponly=False,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
        )

    def require_same_origin(request: Request) -> None:
        origin = request.headers.get("origin")
        if origin is None:
            return
        expected = f"{request.url.scheme}://{request.headers.get('host', '')}"
        if origin.rstrip("/") != expected:
            raise HTTPException(status_code=403, detail="Origin 校验失败")

    def require_invitation_rate_limit(
        request: Request,
        token: str,
        action: str,
    ) -> None:
        now = service._now()
        client = request.client.host if request.client else "unknown"
        token_digest = service.security.digest_token(token)
        for key, (_, reset_at) in list(invitation_rate_limits.items()):
            if aware_utc(reset_at) <= now:
                del invitation_rate_limits[key]

        keys = [
            (action, "client", client),
            (action, "token", f"{client}:{token_digest}"),
        ]
        for key in keys:
            count, _ = invitation_rate_limits.get(
                key,
                (0, now + invitation_rate_limit_window),
            )
            if count >= invitation_rate_limit_max:
                raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
        for key in keys:
            count, reset_at = invitation_rate_limits.get(
                key,
                (0, now + invitation_rate_limit_window),
            )
            invitation_rate_limits[key] = (count + 1, reset_at)

    def build_activation_url(request: Request, token: str) -> str:
        return str(request.base_url).rstrip("/") + f"/activate/{token}"

    def resolve_active_invitation(
        session: Session,
        token: str,
    ) -> tuple[
        InvitationRecord,
        UserRecord,
        WorkspaceRecord,
        WorkspaceMembershipRecord,
    ]:
        invitation = session.scalar(
            select(InvitationRecord).where(
                InvitationRecord.token_digest == service.security.digest_token(token),
            ),
        )
        if invitation is None:
            raise HTTPException(status_code=409, detail="邀请已失效")

        now = service._now()
        if invitation.revoked_at is not None:
            raise HTTPException(status_code=409, detail="邀请已撤销")
        if invitation.used_at is not None:
            raise HTTPException(status_code=409, detail="邀请已使用")
        if aware_utc(invitation.expires_at) <= now:
            raise HTTPException(status_code=409, detail="邀请已过期")

        user = session.get(UserRecord, invitation.user_id)
        workspace = session.get(WorkspaceRecord, invitation.workspace_id)
        membership = session.scalar(
            select(WorkspaceMembershipRecord).where(
                WorkspaceMembershipRecord.workspace_id == invitation.workspace_id,
                WorkspaceMembershipRecord.user_id == invitation.user_id,
            ),
        )
        if user is None or workspace is None or membership is None:
            raise HTTPException(status_code=409, detail="邀请已失效")
        if user.status == "disabled":
            raise HTTPException(status_code=409, detail="该用户已被停用")
        return invitation, user, workspace, membership

    def authenticated(
        session: Session = Depends(get_session),
        session_token: str | None = Cookie(
            default=None,
            alias=settings.session_cookie_name,
        ),
    ) -> tuple[UserRecord, SessionRecord, Session]:
        try:
            user, session_record = service.authenticate_session(
                session,
                session_token,
            )
        except AuthenticationError as error:
            raise SessionAuthenticationError(str(error)) from None
        return user, session_record, session

    def csrf_protected(
        authenticated_context: tuple[
            UserRecord,
            SessionRecord,
            Session,
        ] = Depends(authenticated),
        csrf_token: str | None = Header(
            default=None,
            alias="X-CSRF-Token",
        ),
    ) -> tuple[UserRecord, SessionRecord, Session]:
        _, session_record, _ = authenticated_context
        try:
            service.require_csrf(session_record, csrf_token)
        except CsrfError as error:
            raise HTTPException(status_code=403, detail=str(error)) from None
        return authenticated_context

    @router.post("/api/auth/login", response_model=AuthSessionRead)
    def login(
        payload: LoginCreate,
        request: Request,
        response: Response,
        session: Session = Depends(get_session),
    ) -> AuthSessionRead:
        require_same_origin(request)
        try:
            user, _, session_token, csrf_token = service.login(
                session,
                email=payload.email,
                password=payload.password,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        except AccountLocked as error:
            raise HTTPException(status_code=429, detail=str(error)) from None
        except AuthenticationConfigurationError:
            raise HTTPException(
                status_code=500,
                detail="认证配置异常",
            ) from None
        except AuthenticationError as error:
            raise HTTPException(status_code=401, detail=str(error)) from None
        set_auth_cookies(response, session_token, csrf_token)
        return AuthSessionRead(user=user)

    @router.get("/api/auth/session", response_model=AuthSessionRead)
    def read_session(
        context: tuple[
            UserRecord,
            SessionRecord,
            Session,
        ] = Depends(authenticated),
    ) -> AuthSessionRead:
        user, _, _ = context
        return AuthSessionRead(user=user)

    @router.post("/api/auth/logout", status_code=204)
    def logout(
        response: Response,
        context: tuple[
            UserRecord,
            SessionRecord,
            Session,
        ] = Depends(csrf_protected),
    ) -> None:
        _, session_record, session = context
        service.revoke_session(session, session_record, "logout")
        clear_auth_cookies(response, settings)

    @router.post("/api/auth/change-password", status_code=204)
    def change_password(
        payload: ChangePasswordCreate,
        response: Response,
        context: tuple[
            UserRecord,
            SessionRecord,
            Session,
        ] = Depends(csrf_protected),
    ) -> None:
        user, _, session = context
        try:
            service.change_password(
                session,
                user,
                current_password=payload.current_password,
                new_password=payload.new_password,
            )
        except PasswordChangeError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        clear_auth_cookies(response, settings)

    @router.get("/api/invitations/{token}", response_model=InvitationPreviewRead)
    def preview_invitation(
        token: str,
        request: Request,
        session: Session = Depends(get_session),
    ) -> InvitationPreviewRead:
        require_same_origin(request)
        require_invitation_rate_limit(request, token, "preview")
        invitation, user, workspace, _ = resolve_active_invitation(session, token)
        return InvitationPreviewRead(
            email=user.email or "",
            workspace_name=workspace.name,
            role=invitation.role,
            expires_at=invitation.expires_at,
        )

    @router.post("/api/invitations/{token}/activate", status_code=204)
    def activate_invitation(
        token: str,
        payload: InvitationActivateCreate,
        request: Request,
        session: Session = Depends(get_session),
    ) -> None:
        require_same_origin(request)
        require_invitation_rate_limit(request, token, "activate")
        invitation, user, workspace, membership = resolve_active_invitation(session, token)
        now = service._now()
        service.set_password(
            session,
            user,
            display_name=payload.display_name,
            password=payload.password,
        )
        user.status = "active"
        user.failed_login_count = 0
        user.locked_until = None
        user.last_workspace_id = workspace.id
        membership.status = "active"
        membership.role = invitation.role
        membership.activated_at = now
        membership.updated_at = now
        invitation.used_at = now
        audit_service.record(
            session,
            actor=AuditActor(
                organization_id=user.organization_id,
                workspace_id=workspace.id,
                actor_user_id=user.id,
                session_id=None,
            ),
            action="member.invitation.activate",
            target_type="invitation",
            target_id=invitation.id,
            outcome="success",
            request=request,
            metadata={"userId": user.id},
            workspace_id=workspace.id,
        )
        session.commit()

    return router
