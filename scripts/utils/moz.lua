-- ## OSRM profile file

-- The profile file is used to define speeds and routability for OSRM. It is
-- possible to define speeds conditionally based on way tags and other attributes.

-- The profile used for this project is pretty simple and straightforward.
-- The road network only contains roads that we need to account for, not having
-- one ways, traffic lights, private roads, etc. All roads are considered routable
-- depending on the condition and surface.

-- In the moz case we're using the RUC (Road User Cost) to drive what roads are
-- selected, givin priority to roads with a lower cost

-- Additional information about `.lua` profiles:
-- - https://www.winwaed.com/blog/2015/11/18/osrms-lua-scripts/
-- - https://github.com/Project-OSRM/osrm-backend/wiki/Profiles
-- - https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md

api_version = 4

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
    }
  }
end

function process_node (profile, node, result)
  -- The road network is very simple. Nothing to do on nodes.
end

function process_way (profile, way, result)
  local road_class = way:get_value_by_key('ROAD_CLASS')
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

  -- In this case we don't care about the routing time.
  -- We just need the routing engine to pick the best route given the RUC.
  -- Set the speed such as the lower the RUC the better.
  -- By doing 1 / ruc, the resulting time will be our cost.
  result.forward_speed = 1 / ruc
  result.backward_speed = 1 / ruc

  -- The weight can be thought of as the resistance or cost when
  -- passing the way. Routing will prefer ways with low weight.
  -- The weight can't be used, because the routing engine will choose the
  -- way with the lowest ruc as it goes instead of looking at the
  -- overall picture.
  -- result.weight = ruc

  -- By setting rate = speed on all ways, the result will be fastest
  -- path routing. We multiply be 1000 to ensure the value is big enough that
  -- there are no doubts.
  result.forward_rate = 1 / ruc * 1000
  result.backward_rate = 1 / ruc * 1000

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
