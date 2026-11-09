CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint VARCHAR(2048) NOT NULL UNIQUE,
    p256dh VARCHAR(87) NOT NULL,
    auth VARCHAR(22) NOT NULL
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS push_deliveries (
    notification_id BIGINT NOT NULL REFERENCES user_notifications(id) ON DELETE CASCADE,
    subscription_id BIGINT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS push_deliveries_due_idx ON push_deliveries (next_attempt_at);
CREATE INDEX IF NOT EXISTS push_deliveries_subscription_idx ON push_deliveries (subscription_id);

CREATE OR REPLACE FUNCTION enqueue_notification_push() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO push_deliveries (notification_id, subscription_id)
    SELECT NEW.id, id FROM push_subscriptions WHERE user_id = NEW.recipient_user_id FOR KEY SHARE;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notifications_enqueue_push ON user_notifications;
CREATE TRIGGER user_notifications_enqueue_push
AFTER INSERT ON user_notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_notification_push();
