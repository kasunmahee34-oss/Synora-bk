ALTER TABLE `rate_plans`
  ADD COLUMN `booking_source` ENUM('direct','travel_agent','walk_in','online') NULL;

ALTER TABLE `rate_plans`
  DROP INDEX `rate_plans_room_type_id_travel_agent_id_meal_plan_id_key`,
  ADD UNIQUE INDEX `RatePlan_roomTypeId_travelAgentId_mealPlanId_bookingSource_key`
    (`room_type_id`, `travel_agent_id`, `meal_plan_id`, `booking_source`);
