-- Reset onboarding_step to 'profile' for any student who has no approved class membership.
-- This forces them through the full profile → class → pending flow.
UPDATE users
SET onboarding_step = 'profile'
WHERE role = 'student'
  AND onboarding_step IN ('class', 'complete')
  AND id NOT IN (
    SELECT user_id FROM class_memberships WHERE status = 'approved'
  );
