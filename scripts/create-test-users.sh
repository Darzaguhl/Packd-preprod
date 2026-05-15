#!/usr/bin/env bash
# Creates one test user per role (franchise_admin, studio_admin, instructor, member)
# and inserts the DB records needed for each.
#
# Usage: SERVICE_ROLE_KEY=<your_key> bash scripts/create-test-users.sh
#
# Service role key: Supabase Dashboard → Settings → API → service_role (secret)

set -e

SUPABASE_URL="https://ghayufxnbqubecgblvtg.supabase.co"
STUDIO_ID="cmp5ogcib0000lwtcb7dr7foj"
PASSWORD="Packd2025!"

KEY="${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY env var is required}"

echo "→ Creating Supabase auth users..."

create_auth_user() {
  local email="$1"
  local role="$2"
  local first="$3"
  local last="$4"

  curl -s -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
    -H "Authorization: Bearer ${KEY}" \
    -H "apikey: ${KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"${email}\",
      \"password\": \"${PASSWORD}\",
      \"email_confirm\": true,
      \"app_metadata\": { \"role\": \"${role}\" },
      \"user_metadata\": { \"firstName\": \"${first}\", \"lastName\": \"${last}\" }
    }" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

FRANCHISE_ID=$(create_auth_user "franchise@packd.test" "franchise_admin" "Frances" "Chain")
echo "  franchise_admin : franchise@packd.test  (uid: ${FRANCHISE_ID})"

STUDIO_ADM_ID=$(create_auth_user "studioadmin@packd.test" "studio_admin" "Sam" "Admin")
echo "  studio_admin    : studioadmin@packd.test (uid: ${STUDIO_ADM_ID})"

INSTRUCTOR_ID=$(create_auth_user "instructor@packd.test" "instructor" "Alex" "Coach")
echo "  instructor      : instructor@packd.test  (uid: ${INSTRUCTOR_ID})"

MEMBER_ID=$(create_auth_user "member@packd.test" "member" "Max" "Member")
echo "  member          : member@packd.test      (uid: ${MEMBER_ID})"

echo ""
echo "→ Creating DB records via PostgREST..."

rest_insert() {
  local table="$1"
  local body="$2"
  curl -s -o /dev/null -w "%{http_code}" -X POST "${SUPABASE_URL}/rest/v1/${table}" \
    -H "Authorization: Bearer ${KEY}" \
    -H "apikey: ${KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$body"
}

# Helper: generate a simple unique ID
uid() { python3 -c "import uuid; print(str(uuid.uuid4()).replace('-','')[:25])" 2>/dev/null || date +%s%N | md5sum | head -c 25; }

# ── franchise_admin ── no Member record needed (bypasses studio check)

# ── studio_admin ──
if [ -n "$STUDIO_ADM_ID" ]; then
  STATUS=$(rest_insert "User" "{\"id\":\"${STUDIO_ADM_ID}\",\"email\":\"studioadmin@packd.test\",\"firstName\":\"Sam\",\"lastName\":\"Admin\"}")
  echo "  User (studio_admin):  HTTP ${STATUS}"

  SADM_MEMBER_ID=$(uid)
  STATUS=$(rest_insert "Member" "{\"id\":\"${SADM_MEMBER_ID}\",\"userId\":\"${STUDIO_ADM_ID}\",\"studioId\":\"${STUDIO_ID}\"}")
  echo "  Member (studio_admin): HTTP ${STATUS}"

  STATUS=$(rest_insert "CreditBalance" "{\"id\":\"$(uid)\",\"memberId\":\"${SADM_MEMBER_ID}\",\"balance\":0}")
  echo "  CreditBalance:        HTTP ${STATUS}"
fi

# ── instructor ──
if [ -n "$INSTRUCTOR_ID" ]; then
  STATUS=$(rest_insert "User" "{\"id\":\"${INSTRUCTOR_ID}\",\"email\":\"instructor@packd.test\",\"firstName\":\"Alex\",\"lastName\":\"Coach\"}")
  echo "  User (instructor):    HTTP ${STATUS}"

  INSTR_MEMBER_ID=$(uid)
  STATUS=$(rest_insert "Member" "{\"id\":\"${INSTR_MEMBER_ID}\",\"userId\":\"${INSTRUCTOR_ID}\",\"studioId\":\"${STUDIO_ID}\"}")
  echo "  Member (instructor):  HTTP ${STATUS}"

  STATUS=$(rest_insert "CreditBalance" "{\"id\":\"$(uid)\",\"memberId\":\"${INSTR_MEMBER_ID}\",\"balance\":5}")
  echo "  CreditBalance:        HTTP ${STATUS}"

  STATUS=$(rest_insert "Instructor" "{\"id\":\"$(uid)\",\"userId\":\"${INSTRUCTOR_ID}\",\"studioId\":\"${STUDIO_ID}\"}")
  echo "  Instructor record:    HTTP ${STATUS}"
fi

# ── member ──
if [ -n "$MEMBER_ID" ]; then
  STATUS=$(rest_insert "User" "{\"id\":\"${MEMBER_ID}\",\"email\":\"member@packd.test\",\"firstName\":\"Max\",\"lastName\":\"Member\"}")
  echo "  User (member):        HTTP ${STATUS}"

  MBR_MEMBER_ID=$(uid)
  STATUS=$(rest_insert "Member" "{\"id\":\"${MBR_MEMBER_ID}\",\"userId\":\"${MEMBER_ID}\",\"studioId\":\"${STUDIO_ID}\"}")
  echo "  Member record:        HTTP ${STATUS}"

  STATUS=$(rest_insert "CreditBalance" "{\"id\":\"$(uid)\",\"memberId\":\"${MBR_MEMBER_ID}\",\"balance\":10}")
  echo "  CreditBalance:        HTTP ${STATUS}"
fi

echo ""
echo "Done. All users have password: ${PASSWORD}"
echo ""
echo "  franchise@packd.test   → franchise_admin → /dashboard"
echo "  studioadmin@packd.test → studio_admin    → /dashboard"
echo "  instructor@packd.test  → instructor      → /dashboard"
echo "  member@packd.test      → member          → /schedule"
