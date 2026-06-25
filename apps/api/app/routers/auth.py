from collections.abc import Callable

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth import (
    AccountLocked,
    AuthenticationError,
    AuthenticationService,
    CsrfError,
    PasswordChangeError,
)
from app.config import Settings
from app.models import SessionRecord, UserRecord
from app.schemas import AuthSessionRead, ChangePasswordCreate, LoginCreate


def create_auth_router(
    get_session: Callable,
    service: AuthenticationService,
    settings: Settings,
) -> APIRouter:
    router = APIRouter(prefix="/api/auth", tags=["auth"])

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

    def clear_auth_cookies(response: Response) -> None:
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

    def require_same_origin(request: Request) -> None:
        origin = request.headers.get("origin")
        if origin is None:
            return
        expected = f"{request.url.scheme}://{request.headers.get('host', '')}"
        if origin.rstrip("/") != expected:
            raise HTTPException(status_code=403, detail="Origin 校验失败")

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
            raise HTTPException(status_code=401, detail=str(error)) from None
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

    @router.post("/login", response_model=AuthSessionRead)
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
        except AuthenticationError as error:
            raise HTTPException(status_code=401, detail=str(error)) from None
        set_auth_cookies(response, session_token, csrf_token)
        return AuthSessionRead(user=user)

    @router.get("/session", response_model=AuthSessionRead)
    def read_session(
        context: tuple[
            UserRecord,
            SessionRecord,
            Session,
        ] = Depends(authenticated),
    ) -> AuthSessionRead:
        user, _, _ = context
        return AuthSessionRead(user=user)

    @router.post("/logout", status_code=204)
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
        clear_auth_cookies(response)

    @router.post("/change-password", status_code=204)
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
        clear_auth_cookies(response)

    return router
