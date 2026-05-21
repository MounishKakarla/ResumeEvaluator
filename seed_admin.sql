-- Run once to create the admin user, then delete this file.
INSERT INTO users (email, hashed_password, role, created_at)
VALUES (
    'mounish.k@tektalis.com',
    '$2a$12$RL663QJLLd8UiVs1/ygjHOw8JTn2s2W09jZrAMMCaM38etqXchb7O',
    'admin',
    NOW()
)
ON CONFLICT (email) DO NOTHING;
