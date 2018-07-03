# About the test data

## Road network

![](fixtures/roadnetwork-diagram.jpg)

| id | length in km | RUC | ROAD_CLASS | AVG_COND |
| --- | --- | --- | --- | --- |
| 1 | 1 | 1.25 | Unpaved | poor |
| 2 | 1 | 1.25 | Unpaved | poor |
| 3 | 1 | 1.25 | Unpaved | poor |
| 4 | 1 | 0.75 | Unpaved | poor |
| 5 | 2 | 0.75 | Unpaved | poor |
| 6 | 1 | 0.75 | Unpaved | poor |
| 7 | 1 | 0.8 | Unpaved | poor |
| 8 | 2 | 0.8 | Unpaved | poor |
| 9 | 1 | 0.8 | Unpaved | poor |
| 10 | 0.5 | 0.8 | Unpaved | poor |

## OD Pairs
The dataset contains 3 points of interest.

### A - B
`A - B` has three potential routes, ordered here from lowest total RUC to highest.

- **Route 1**  
  - Road segments: `1-2-3`
  - Total RUC = $ 3.75
  - Unroutable in return period: 9 and 10
- **Route 2**  
  - Road segments: `1-4-5-6`
  - Total RUC = $ 4.00
  - Unroutable in return period: 10
- **Route 3**  
  - Road segments: `1-7-8-9`
  - Total RUC = $ 4.20
  - Always routable

`A - B` is routable in all return periods.

### A & B - C
`A - C` and `B - C` is unroutable in return period 9 and 10. No EAUL can be calculated.

## Floods
Road segments are generally not flooded, except in the following cases:

- segment 2 has 20 meters in return period 9 and 10
- segment 3 has 20 meters in return period 9 and 10
- segment 5 has 20 meters in return period 10

## Traffic
Traffic is stable at 100 / day, for all directions on all OD pairs.
