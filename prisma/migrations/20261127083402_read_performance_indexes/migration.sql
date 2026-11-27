-- Indexes chosen from measured query plans at 50,000 users and 300,000
-- audit entries. See docs/performance.md.

-- Audit log: newest-first reading and cursor paging.
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt" DESC, "id" DESC);

-- Audit log: "this action, newest first" and "this action in the last 24 hours".
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

-- Users: newest-first listing without a sort step.
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt" DESC, "id");
