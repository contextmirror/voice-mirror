"""Weather tool handler using Open-Meteo API.

Open-Meteo is a free, no-auth weather API.
https://open-meteo.com/

Use cases:
- "What's the weather?" -> current conditions + today's forecast
- "What's the weather tomorrow?" -> tomorrow's forecast
- "Will it rain today?" -> precipitation check
"""

import json
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False


# WMO Weather interpretation codes
# https://open-meteo.com/en/docs
WMO_CODES = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "foggy",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "slight snow",
    73: "moderate snow",
    75: "heavy snow",
    77: "snow grains",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "slight snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with slight hail",
    99: "thunderstorm with heavy hail",
}


class WeatherHandler:
    """Get weather forecasts using Open-Meteo API."""

    def __init__(self, default_location: str = "London, UK"):
        self.default_location = default_location
        self._coord_cache: Dict[str, Tuple[float, float]] = {}

    def _normalize_location(self, location: str) -> list:
        """
        Generate location query variants for geocoding.
        Returns a list of queries to try in order.
        """
        queries = [location]

        # Common abbreviations that confuse the geocoder
        abbreviations = {
            ", UK": ", United Kingdom",
            ",UK": ", United Kingdom",
            " UK": " United Kingdom",
            ", US": ", United States",
            ",US": ", United States",
            " US": " United States",
            ", USA": ", United States",
        }

        # Try with expanded abbreviations
        for abbrev, full in abbreviations.items():
            if abbrev in location:
                queries.append(location.replace(abbrev, full))

        # Also try just the city name (before first comma)
        if "," in location:
            city_only = location.split(",")[0].strip()
            queries.append(city_only)

        return queries

    async def _geocode(self, location: str) -> Optional[Tuple[float, float]]:
        """Convert location name to coordinates using Open-Meteo geocoding."""
        if location in self._coord_cache:
            return self._coord_cache[location]

        if not HTTPX_AVAILABLE:
            return None

        # Try multiple query variants
        queries = self._normalize_location(location)

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for query in queries:
                    response = await client.get(
                        "https://geocoding-api.open-meteo.com/v1/search",
                        params={"name": query, "count": 1, "language": "en"}
                    )
                    response.raise_for_status()
                    data = response.json()

                    results = data.get("results", [])
                    if results:
                        lat = results[0]["latitude"]
                        lon = results[0]["longitude"]
                        self._coord_cache[location] = (lat, lon)
                        return (lat, lon)

                return None
        except Exception:
            return None

    async def execute(
        self,
        location: str = "",
        when: str = "today",
        units: str = "metric",
        **kwargs
    ) -> str:
        """
        Get weather forecast.

        Args:
            location: Location name (city, country). Defaults to settings location.
            when: "today", "tomorrow", or "week"
            units: "metric" (Celsius) or "imperial" (Fahrenheit)
        """
        if not HTTPX_AVAILABLE:
            return "Weather unavailable - httpx not installed"

        location = location or self.default_location

        # Geocode the location
        coords = await self._geocode(location)
        if not coords:
            return f"Couldn't find location: {location}"

        lat, lon = coords

        # Build API request
        temp_unit = "fahrenheit" if units == "imperial" else "celsius"
        wind_unit = "mph" if units == "imperial" else "kmh"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
                        "temperature_unit": temp_unit,
                        "wind_speed_unit": wind_unit,
                        "timezone": "auto",
                        "forecast_days": 7,
                    }
                )
                response.raise_for_status()
                data = response.json()

            return self._format_response(data, location, when, units)

        except httpx.ConnectError:
            return "Couldn't connect to weather service"
        except Exception as e:
            return f"Weather error: {e}"

    def _format_response(
        self,
        data: Dict[str, Any],
        location: str,
        when: str,
        units: str
    ) -> str:
        """Format weather data for voice output."""
        current = data.get("current", {})
        daily = data.get("daily", {})

        temp_symbol = "°F" if units == "imperial" else "°C"
        wind_symbol = "mph" if units == "imperial" else "km/h"

        # Current conditions
        current_temp = current.get("temperature_2m")
        feels_like = current.get("apparent_temperature")
        humidity = current.get("relative_humidity_2m")
        weather_code = current.get("weather_code", 0)
        wind_speed = current.get("wind_speed_10m")
        conditions = WMO_CODES.get(weather_code, "unknown")

        if when == "today":
            # Today's forecast with current conditions
            today_high = daily.get("temperature_2m_max", [None])[0]
            today_low = daily.get("temperature_2m_min", [None])[0]
            precip_chance = daily.get("precipitation_probability_max", [None])[0]

            parts = []

            # Current conditions
            if current_temp is not None:
                parts.append(f"Currently {int(current_temp)}{temp_symbol} and {conditions}")
                if feels_like is not None and abs(feels_like - current_temp) >= 3:
                    parts.append(f"feels like {int(feels_like)}{temp_symbol}")

            # Today's range
            if today_high is not None and today_low is not None:
                parts.append(f"High of {int(today_high)}{temp_symbol}, low of {int(today_low)}{temp_symbol}")

            # Precipitation
            if precip_chance is not None and precip_chance > 20:
                parts.append(f"{int(precip_chance)}% chance of rain")

            return ". ".join(parts) if parts else "Weather data unavailable"

        elif when == "tomorrow":
            # Tomorrow's forecast
            if len(daily.get("temperature_2m_max", [])) < 2:
                return "Tomorrow's forecast unavailable"

            tomorrow_high = daily["temperature_2m_max"][1]
            tomorrow_low = daily["temperature_2m_min"][1]
            tomorrow_code = daily.get("weather_code", [0, 0])[1]
            tomorrow_precip = daily.get("precipitation_probability_max", [0, 0])[1]
            tomorrow_conditions = WMO_CODES.get(tomorrow_code, "unknown")

            parts = [f"Tomorrow: {tomorrow_conditions}"]
            parts.append(f"High of {int(tomorrow_high)}{temp_symbol}, low of {int(tomorrow_low)}{temp_symbol}")

            if tomorrow_precip > 20:
                parts.append(f"{int(tomorrow_precip)}% chance of rain")

            return ". ".join(parts)

        elif when == "week":
            # Weekly summary
            days = daily.get("time", [])[:7]
            highs = daily.get("temperature_2m_max", [])[:7]
            lows = daily.get("temperature_2m_min", [])[:7]
            codes = daily.get("weather_code", [])[:7]

            if not days:
                return "Weekly forecast unavailable"

            # Find warmest and coldest days
            if highs:
                max_high = max(highs)
                min_low = min(lows) if lows else None

                # Count rainy days
                rainy_codes = {51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99}
                rainy_days = sum(1 for c in codes if c in rainy_codes)

                parts = [f"This week: highs around {int(max_high)}{temp_symbol}"]
                if min_low is not None:
                    parts.append(f"lows around {int(min_low)}{temp_symbol}")
                if rainy_days > 0:
                    parts.append(f"{rainy_days} day{'s' if rainy_days > 1 else ''} with rain expected")

                return ". ".join(parts)

            return "Weekly forecast unavailable"

        return "Weather data unavailable"


def register_weather_tools(default_location: str = "London, UK") -> dict:
    """Create and return weather tool handlers.

    Args:
        default_location: Default location for weather queries

    Returns:
        Dict of tool_name -> handler
    """
    handler = WeatherHandler(default_location)

    return {
        "weather": handler,
    }
