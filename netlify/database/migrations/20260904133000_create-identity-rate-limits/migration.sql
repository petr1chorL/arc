CREATE TABLE identity_rate_limits (
    bucket_key VARCHAR(255) PRIMARY KEY,
    window_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    count INTEGER NOT NULL
);

CREATE INDEX ix_identity_rate_limits_window_started_at
    ON identity_rate_limits (window_started_at);
