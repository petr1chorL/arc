"""Replay candidate HTTP requests over explicitly supplied synthetic database rows."""
import json
import os
from datetime import datetime
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api"), str(ROOT / "apps/api/tests")]
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["ENVIRONMENT"] = "development"
from app.config import Settings
Settings.model_config["env_file"] = None
from sqlalchemy import DateTime, select
from app.models import (ArtifactVersionRecord, ArtifactDiffRecord, WorkflowRunRecord, HumanTaskRecord,
                        FeedbackCandidateRecord, GoldenSampleRecord, ReviewerRecord, UserRecord)
from api_test_support import create_authenticated_client, csrf_headers, workspace_url

MODELS = [ArtifactVersionRecord, ArtifactDiffRecord, WorkflowRunRecord, HumanTaskRecord,
          FeedbackCandidateRecord, GoldenSampleRecord, ReviewerRecord]


def replay(data):
    with TemporaryDirectory(prefix="arc-feedback-http-") as directory:
        client, workspace_id = create_authenticated_client(f"sqlite:///{Path(directory) / 'contract.db'}")
        try:
            with client.app.state.session_factory() as session:
                user_id = session.scalar(select(UserRecord.id).where(UserRecord.is_organization_admin.is_(True)))
                assert user_id
                for model in MODELS:
                    for source in data["tables"][model.__tablename__]:
                        row = dict(source)
                        row["workspace_id"] = workspace_id if row["workspace_id"] == "a" else "foreign-space"
                        if model is ReviewerRecord:
                            row["user_id"] = user_id
                        for column in model.__table__.columns:
                            if isinstance(column.type, DateTime) and row.get(column.name) is not None:
                                row[column.name] = datetime.fromisoformat(row[column.name])
                        session.add(model(**row))
                session.commit()
            results = []
            for case in data["cases"]:
                response = client.request(case["method"], workspace_url(workspace_id, "/feedback-candidates" + case["suffix"]),
                    headers=csrf_headers(client), **({"json": case["body"]} if "body" in case else {}))
                assert response.status_code == case["status"], (case, response.status_code, response.text)
                results.append({"status": response.status_code, "body": response.json()})
            return results
        finally:
            client.close()
            client.app.state.session_factory.kw["bind"].dispose()


if __name__ == "__main__":
    print(json.dumps(replay(json.loads(sys.stdin.buffer.read().decode("utf-8"))), ensure_ascii=True))
