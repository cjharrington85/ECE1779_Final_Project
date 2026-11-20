# Route integration tests

Run with Node.js 20 or newer, the server dependencies installed, and a local
PostgreSQL instance. The tests create a uniquely named database, apply
`db/init/001_schema.sql`, reset fixtures between tests, and drop the database
on normal teardown. The PostgreSQL user needs permission to create databases.

For example, start a disposable PostgreSQL container from the repository root.

```sh
docker run --rm -d --name ece1779-route-tests \
  -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=route-test-password postgres:16
docker exec ece1779-route-tests pg_isready -h 127.0.0.1 -U postgres
TEST_DB_PORT=55432 TEST_DB_PASSWORD=route-test-password npm --prefix server test
docker stop ece1779-route-tests
```

Wait for `pg_isready` to report that PostgreSQL is accepting connections before
running the suite. Set `TEST_DB_USER` if the local test instance uses a different
user. The default is `postgres`.

With PostgreSQL running, select a suite from the repository root.

```sh
export TEST_DB_PORT=55432 TEST_DB_PASSWORD=route-test-password
npm --prefix server run test:task
npm --prefix server run test:project
npm --prefix server run test:team
npm --prefix server run test:user
```

The Task suite covers the single-task routes. The Project suite covers project
routes and the task collection under `/api/projects/:projectId/tasks`.
The Team suite covers team management, membership, and admin permissions.
The User suite covers profile updates, account deletion, and JWT rejection
after account deletion. `npm --prefix server test` runs all four suites.

The WebSocket suite uses the same disposable database and can be run with
`npm --prefix server run test:websocket`. It checks authentication, project
permissions, task INSERT/UPDATE/DELETE notifications, separate replica listeners,
and removal of a subscribed member.
