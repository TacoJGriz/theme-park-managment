USE park_database;

-- generate x members with membership dates starting randomly in 2024
CALL GenerateMembers(4512, 2024);

-- generate weather event, visits, and ride volume data from year X to year Y with Z base daily visitors 
CALL GenerateHistoricalData(2025, 2025, 20);