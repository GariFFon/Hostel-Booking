.PHONY: services db-reset dev-be dev-fe worker openapi test e2e

services:        ## start Postgres 16 (:5433) and Redis (:6379)
	brew services start postgresql@16 && brew services start redis

dev-be:          ## backend API on :4000
	cd backend && pnpm dev

dev-fe:          ## website on :3000
	cd frontend && pnpm dev

worker:          ## background worker (queues, cron)
	cd backend && pnpm worker

db-reset:        ## drop, migrate and seed the dev database
	cd backend && pnpm db:reset && pnpm db:seed

openapi:         ## regenerate backend/openapi.json and frontend types
	cd backend && pnpm openapi && cd ../frontend && pnpm gen:api

test:
	cd backend && pnpm test

e2e:             ## browser tests: needs backend (pnpm dev:all) + seeded db
	cd frontend && pnpm e2e
