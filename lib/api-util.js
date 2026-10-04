let Emitter = require('events');


let nextAPICallEmitter = new Emitter();

exports.HOST = 'https://api.weather.com'

exports.defaultParams = function () {
  return {
    qs: {
      apiKey: process.env.WEATHER_API_KEY,
      language: 'en-US'
    },
    headers: {
      'User-Agent': 'weather-alerts-api-feeder',
      'Accept': 'application/json'
    },
    json: true // parse the response as JSON
  }
};

exports.nextAPICallEmitter = nextAPICallEmitter;
