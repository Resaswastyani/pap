-- PAP-MS: merek & model perangkat pada log aktivitas
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS device_brand VARCHAR(60)  NULL AFTER device_type;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS device_model VARCHAR(100) NULL AFTER device_brand;
