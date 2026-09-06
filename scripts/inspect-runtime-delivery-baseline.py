"""Observe legacy notification replay after an uncommitted acknowledgement.

Only an in-memory SQLite database and a counting adapter are used. This is a
baseline diagnostic, not a passing migration acceptance test or external send.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base, NotificationOutboxRecord
from app.notification_dispatcher import NotificationDispatchResult, NotificationOutboxDispatchService


class CountingDelivery:
    def __init__(self):
        self.calls = []

    def send(self, delivery):
        self.calls.append(delivery.event_key)
        return NotificationDispatchResult(status='sent', provider_message_id=f'synthetic-{len(self.calls)}')


def main():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)
    adapter = CountingDelivery()
    dispatcher = NotificationOutboxDispatchService(adapter)
    try:
        with factory() as session:
            session.add(NotificationOutboxRecord(id='synthetic-notice', workspace_id='synthetic-space',
                event_key='synthetic-event', human_task_id='synthetic-task', event_type='review.requested',
                recipient_type='reviewer', recipient_id='synthetic-reviewer', payload={}))
            session.commit()
        with factory() as session:
            first = dispatcher.dispatch_pending(session, workspace_id='synthetic-space')
            assert first['sent'] == 1
            # The recipient has acknowledged; emulate process loss before DB commit.
            session.rollback()
        with factory() as session:
            after_loss = session.get(NotificationOutboxRecord, 'synthetic-notice').status
            second = dispatcher.dispatch_pending(session, workspace_id='synthetic-space')
            session.commit()
            final = session.get(NotificationOutboxRecord, 'synthetic-notice').status
        assert (after_loss, second['sent'], final, len(adapter.calls)) == ('pending', 1, 'sent', 2)
        print(json.dumps({'baselineOnly': True, 'externalNetworkCalls': 0,
            'countingAdapterCalls': len(adapter.calls), 'sameEventReplayed': len(set(adapter.calls)) == 1,
            'statusAfterLostCommit': after_loss, 'finalStatus': final,
            'finding': 'legacy notification retry can repeat an acknowledged effect before durable commit'}))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
