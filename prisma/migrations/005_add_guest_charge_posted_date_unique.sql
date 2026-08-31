-- Migration: Add posted_date generated column and unique index to prevent duplicate Room Charge postings per reservation per date

-- Add a stored/generated date column derived from posted_at
ALTER TABLE guest_charges
  ADD COLUMN posted_date DATE GENERATED ALWAYS AS (DATE(posted_at)) STORED;

-- Create a unique index to prevent more than one charge of same type on same reservation/date
CREATE UNIQUE INDEX ux_guest_charges_reservation_charge_date ON guest_charges (reservation_id, charge_type_id, posted_date);

-- Note: This index will prevent creating two guest_charges with same reservation, charge type and posting date.
-- If your environment allows posting a new charge for the same date after voiding, you may need to drop the index or adapt it to include is_void in the uniqueness expression (MySQL does not support partial indexes). Alternatively, consider setting posted_date to NULL for voided charges or handle via application logic.
