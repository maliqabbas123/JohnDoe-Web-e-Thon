import "server-only";
import type { AttemptStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import { effectiveAttemptStatus } from "./contact";
import type { ClientIncident } from "./schemas";

type IncidentAttempt = {
  status: AttemptStatus;
  deadlineAt: Date;
  requireFullscreen: boolean;
  blockClipboard: boolean;
  blockContextMenu: boolean;
  detectExtraDisplay: boolean;
};

const switchFor = {
  FULLSCREEN_EXIT: "requireFullscreen",
  COPY_ATTEMPT: "blockClipboard",
  PASTE_ATTEMPT: "blockClipboard",
  CONTEXT_MENU: "blockContextMenu",
  EXTRA_DISPLAY: "detectExtraDisplay",
} as const satisfies Partial<Record<ClientIncident["type"], keyof IncidentAttempt>>;

function reportedPosition(event: ClientIncident) {
  return event.type === "COPY_ATTEMPT" || event.type === "PASTE_ATTEMPT" ? event.details.position : undefined;
}

export async function recordClientIncidents(attemptId: string, candidateId: string, incidents: ClientIncident[]) {
  return db.$transaction(async (tx) => {
    const [attempt] = await tx.$queryRaw<IncidentAttempt[]>`
      SELECT a.status, a."deadlineAt", e."requireFullscreen", e."blockClipboard",
             e."blockContextMenu", e."detectExtraDisplay"
      FROM "Attempt" a JOIN "Exam" e ON e.id = a."examId"
      WHERE a.id = ${attemptId} AND a."userId" = ${candidateId} AND NOT a."isSandbox"
      FOR UPDATE OF a
    `;
    if (!attempt) throw errors.notFound();
    const now = new Date();
    if (effectiveAttemptStatus(attempt.status, attempt.deadlineAt, now) !== "IN_PROGRESS") {
      throw errors.conflict("The attempt is closed.");
    }

    const positions = [...new Set(incidents.flatMap((event) => {
      const position = reportedPosition(event);
      return position === undefined ? [] : [position];
    }))];
    const questions = positions.length
      ? await tx.attemptQuestion.findMany({
          where: { attemptId, position: { in: positions } },
          select: { id: true, position: true },
        })
      : [];
    const questionIds = new Map(questions.map(({ id, position }) => [position, id]));

    const data = incidents.map((event, index) => {
      if (event.type in switchFor && !attempt[switchFor[event.type as keyof typeof switchFor]]) {
        throw errors.validation([{ path: "incidents." + index + ".type", message: "This exam switch is off." }]);
      }
      const position = reportedPosition(event);
      const attemptQuestionId = position === undefined ? undefined : questionIds.get(position);
      if (position !== undefined && !attemptQuestionId) {
        throw errors.validation([{ path: "incidents." + index + ".details.position", message: "Choose a question on this attempt." }]);
      }
      return {
        attemptId, attemptQuestionId, type: event.type, source: "CLIENT" as const, createdAt: now,
        details: "details" in event ? event.details : undefined,
      };
    });
    const { count } = await tx.incident.createMany({ data });
    return { accepted: count };
  });
}
