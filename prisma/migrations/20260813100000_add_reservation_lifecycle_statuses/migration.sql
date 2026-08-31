ALTER TABLE reservations MODIFY COLUMN status
  ENUM('confirmed','checked_in','checked_out','cancelled','no_show','tentative','guaranteed','do_check_in','in_house','due_checkout','completed','room_assigned','closed')
  NOT NULL DEFAULT 'tentative';

