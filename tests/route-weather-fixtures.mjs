// Synthetic MET-format forecasts, never evidence of actual provider conditions.
export function forecastFixture({now='2027-05-19T21:00:00Z',longitude=11.7489,latitude=45.7508}={}) {
  return {type:'Feature',geometry:{type:'Point',coordinates:[longitude,latitude,110]},
    properties:{meta:{updated_at:now,units:{air_temperature:'celsius',wind_speed:'m/s',precipitation_amount:'mm'}},
      timeseries:['2027-05-19T22:00:00Z','2027-05-20T06:00:00Z','2027-05-20T18:00:00Z',
        '2027-05-20T22:00:00Z','2027-05-23T06:00:00Z','2027-05-24T06:00:00Z'].map((time,i)=>({
        time,data:{instant:{details:{air_temperature:12+i,wind_speed:3}},
          ...(i===5?{}:{[i===0?'next_1_hours':'next_6_hours']:{details:{precipitation_amount:i}}})},
      }))}};
}
