USE park_database;

-- generate x members with membership dates starting randomly in 2024
CALL GenerateMembers(500, 2024);

-- generate weather event, visits, and ride volume data from year X to year Y with Z base daily visitors 
CALL GenerateHistoricalData(2024, 2025, 50);