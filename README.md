# Link Local — Backend API

Express 5 + TypeScript + Prisma (PostgreSQL). Password-based auth with JWT.

## Stack
- **Runtime:** Node.js (ESM) + Express 5
- **DB:** PostgreSQL via Prisma ORM
- **Auth:** JWT access/refresh tokens, bcrypt password hashing
- **Validation:** Zod
- **Uploads:** Multer (local disk under `uploads/`, served statically)

## Getting started

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env
#   → set DATABASE_URL to your local PostgreSQL (pgAdmin) connection string,
#     and set the JWT secrets.

# 3. Create the database (once), then run migrations
npm run prisma:migrate      # creates tables from prisma/schema.prisma

# 4. Seed master + demo data
npm run db:seed

# 5. Run the dev server (http://localhost:4000/api/v1)
npm run dev
```

### Seeded logins
| Role     | Email                 | Password   |
|----------|-----------------------|------------|
| Admin    | admin@linklocal.app   | admin123   |
| Resident | demo@linklocal.app    | demo1234   |

## Project structure
```
src/
  config/env.ts          # validated environment (zod)
  lib/                   # prisma client, logger
  middleware/            # auth, validate, error, upload
  utils/                 # ApiError, asyncHandler, jwt, password, pagination, http
  modules/
    auth/                # register, login, me, admin login, refresh
    masters/             # admin master tables (CRUD factory) — cities, areas,
                         #   categories, subcategories, fields, education,
                         #   professions, hobbies, tags, referral sources,
                         #   doc types, coupons, freebies, permissions
    addresses/           # address capture + verification doc upload + admin list
    home/                # aggregated home feed
    feed/                # posts (discussions): list, create, like, comment
    discovery/           # events, groups, service providers (list + detail)
    admin/               # members list, dashboard stats
  routes.ts              # mounts all module routers
  app.ts                 # express app (helmet, cors, rate-limit, static)
  server.ts              # bootstrap + graceful shutdown
prisma/
  schema.prisma          # full DBML v6 translated to Prisma
  seed.ts                # master + demo data
```

## API surface (prefix: `/api/v1`)
| Method | Path                          | Auth   | Description |
|--------|-------------------------------|--------|-------------|
| POST   | `/auth/register`              | —      | Register (resident/SP) |
| POST   | `/auth/login`                 | —      | Login (email/mobile + password) |
| POST   | `/auth/refresh`               | —      | Refresh access token |
| GET    | `/auth/me`                    | user   | Current user + profile |
| POST   | `/auth/admin/login`           | —      | Admin login |
| GET    | `/masters/:resource`          | public | List master data (cities, service-categories, …) |
| POST/PATCH/DELETE | `/masters/:resource`| admin  | Manage master data |
| POST   | `/addresses`                  | user   | Create address |
| GET    | `/addresses/me`               | user   | My address |
| POST   | `/addresses/documents`        | user   | Upload address proof (multipart `document`) |
| GET    | `/addresses/admin/list`       | admin  | Address Capture table |
| GET    | `/home`                       | user   | Aggregated home feed |
| GET    | `/posts`                      | user   | Community discussions |
| POST   | `/posts`                      | user   | Create post |
| POST   | `/posts/:id/like`             | user   | Toggle like |
| POST   | `/posts/:id/comments`         | user   | Add comment |
| GET    | `/events` `/events/:id`       | user   | Workshops / events |
| GET    | `/groups` `/groups/:id`       | user   | Interest groups |
| GET    | `/service-providers[/:id]`    | user   | Service providers |
| GET    | `/admin/dashboard`            | admin  | Dashboard counters |
| GET    | `/admin/members`              | admin  | Members list |
| PATCH  | `/admin/members/:id/status`   | admin  | Activate/block/verify a member |

All list endpoints accept `?page=&pageSize=&q=` (and resource-specific filters).
Responses use `{ success, data }` (or `{ success, data, meta }` for lists).
