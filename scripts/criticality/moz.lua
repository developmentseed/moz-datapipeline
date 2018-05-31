-- ## OSRM profile file

-- The profile file is used to define speeds and routability for OSRM. It is
-- possible to define speeds conditionally based on way tags and other attributes.

-- The profile used for this project is pretty simple and straightforward.
-- The road network only contains roads that we need to account for, not having
-- one ways, traffic lights, private roads, etc. All roads are considered routable
-- depending on the condition and surface.

-- To calculate the maximum speed for each way, 3 properties are
-- taken into account:
-- - ROAD_CLASS
-- - SURF_TYPE
-- - AVG_COND

-- The scripts starts by setting the maximum speed based on the road class,
-- then surface, then condition. The final speed is always the minimum value.
-- For example a Primary road (100) with a Unpaved surface (40) and a
-- Fair condition (80), will have a maximum speed of 40.

-- It is important to note that surface and condition do not act as multipliers
-- that change the base speed. They are speeds in and of itself so, for example,
-- a road with a Poor condition will always have a maximum speed of 40
-- regardless of the class.

-- Additional information about `.lua` profiles:
-- - https://www.winwaed.com/blog/2015/11/18/osrms-lua-scripts/
-- - https://github.com/Project-OSRM/osrm-backend/wiki/Profiles
-- - https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md

api_version = 4

-- Returns the minimum between two values if the a > 0
-- Otherwise returns b
function get_min_above_zero (a, b)
  if a and a > 0 then
    return math.min(a, b)
  else
    return b
  end
end

-- Define the properties and configuration.
function setup ()
  return {
    properties = {
      -- Increase accuracy of routing.
      max_speed_for_map_matching      = 1000000/3.6, -- 1000000kmph -> m/s - Make it unlimited
      weight_name                     = 'ruc',
      weight_precision               = 5
    },

    road_classes = {
      Primary = true,
      Secondary = true,
      Tertiary = true,
      Vicinal = true
    },
 
    class_speeds = {
      Primary = 100,
      Secondary = 80,
      Tertiary = 60,
      Vicinal = 60
    },
    
    surface_speeds = {
      Paved = 100,
      Mixed = 70,
      Unpaved = 40,
      [ 'N/A'] = 0
    },
    
    condition_speeds = {
      Good = 100,
      Fair = 80,
      Poor = 40,
      ['Very Poor'] = 20,
      [ 'N/A'] = 0
    }
  }
end

function process_node (profile, node, result)
  -- The road network is very simple. Nothing to do on nodes.
end

function process_way (profile, way, result)
  local road_class = way:get_value_by_key('ROAD_CLASS')
  local surf_type = way:get_value_by_key('SURF_TYPE')
  local condition = way:get_value_by_key('AVG_COND')
  local ruc = way:get_value_by_key('RUC')

  -- perform an quick initial check and abort if the way is
  -- obviously not routable. The road must have a class
  if (not road_class or not profile.road_classes[road_class])
  then
    return
  end

  local name = way:get_value_by_key('ROAD_NAME')
  -- Set the name that will be used for instructions
  if name then
    result.name = name
  end

  result.forward_mode = mode.driving
  result.backward_mode = mode.driving

  -- Speeds --
  -- if road_class and profile.class_speeds[road_class] then
  --   result.forward_speed = get_min_above_zero(result.forward_speed, profile.class_speeds[road_class])
  --   result.backward_speed = get_min_above_zero(result.backward_speed, profile.class_speeds[road_class])
  -- end

  -- if surf_type and profile.surface_speeds[surf_type] then
  --   result.forward_speed = get_min_above_zero(result.forward_speed, profile.surface_speeds[surf_type])
  --   result.backward_speed = get_min_above_zero(result.backward_speed, profile.surface_speeds[surf_type])
  -- end

  -- if condition and profile.condition_speeds[condition] then
  --   result.forward_speed = get_min_above_zero(result.forward_speed, profile.condition_speeds[condition])
  --   result.backward_speed = get_min_above_zero(result.backward_speed, profile.condition_speeds[condition])
  -- end

  -- In this case we don't care about the routing time.
  -- We just need the routing engine to pick the best route given the RUC.
  -- Set the speed such as the lower the RUC the better.
  -- By doing 1 / ruc, the resulting time will be our cost.
  result.forward_speed = 1 / ruc
  result.backward_speed = 1 / ruc

  -- The weight can be thought of as the resistance or cost when
  -- passing the way. Routing will prefer ways with low weight.
  result.weight = ruc

end

function process_turn (profile, turn)
  -- There are no turn restrictions to process.
end

return {
  setup = setup,
  process_way = process_way,
  process_node = process_node,
  process_turn = process_turn
}
