BEGIN;

DELETE FROM billing_forecasts
WHERE based_on_period_id IN (
    SELECT id FROM billing_periods WHERE analytics_only = TRUE
);

DELETE FROM meter_readings
WHERE billing_period_id IN (
    SELECT id FROM billing_periods WHERE analytics_only = TRUE
);

DELETE FROM billing_periods
WHERE analytics_only = TRUE;

COMMIT;
