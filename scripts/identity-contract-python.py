"""Replay the legacy identity contract against a disposable SQLite database; no .env."""
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["ENVIRONMENT"] = "development"
os.environ["MODEL_API_KEY"] = ""
from app.config import Settings

Settings.model_config["env_file"] = None
from api_test_support import csrf_headers
from app.models import UserRecord, WorkspaceMembershipRecord, WorkspaceRecord
from test_membership_api import create_membership_context, login


def replay():
    with TemporaryDirectory(prefix="arc-identity-contract-") as directory:
        context = create_membership_context(Path(directory))
        client = context["client"]
        workspace_id, user_id = context["workspace_id"], context["member_id"]
        base = f"/api/workspaces/{workspace_id}"
        result = {"unauthenticated": client.get("/api/auth/session").status_code}
        login(client, "admin@example.com")
        result["sessionKeys"] = sorted(client.get("/api/auth/session").json()["user"])
        result["workspaceKeys"] = sorted(client.get(base).json())
        result["memberKeys"] = sorted(client.get(base + "/members").json()[0])
        result["missingCsrf"] = client.post(base + f"/members/{user_id}/user/disable").status_code
        with context["session_factory"]() as session:
            user = session.get(UserRecord, user_id)
            other = WorkspaceRecord(organization_id=user.organization_id, name="Other", slug="other")
            session.add(other)
            session.flush()
            session.add(WorkspaceMembershipRecord(workspace_id=other.id, user_id=user_id,
                                                 role="workspace_admin", status="active"))
            session.commit()
        response = client.post(base + f"/members/{user_id}/user/disable", headers=csrf_headers(client))
        result["globalDisable"] = {"status": response.status_code, "body": response.json()}
        with context["session_factory"]() as session:
            result["targetStatus"] = session.get(UserRecord, user_id).status
        client.close()
        client.app.state.session_factory.kw["bind"].dispose()
        context["session_factory"].kw["bind"].dispose()
        return result


if __name__ == "__main__":
    print(json.dumps(replay(), ensure_ascii=True))
