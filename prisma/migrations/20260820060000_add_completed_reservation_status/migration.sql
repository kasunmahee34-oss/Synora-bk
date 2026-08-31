ALTER TABLE reservations MODIFY COLUMN status
  ENUM('tentative','guaranteed','room_assigned','checked_in','in_house','due_checkout','checked_out','completed','closed','no_show','cancelled')
  NOT NULL DEFAULT 'tentative';
