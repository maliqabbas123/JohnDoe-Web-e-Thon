"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Field, Heading, Panel } from "@/components/shared";
import { api, ApiError } from "@/lib/api";

type Slot = {
  startsAt: string;
  endsAt: string;
  retakeGrantId: string | null;
  attemptsAllowed: number | null;
  attemptsUsed: number;
};
type Exam = {
  id: string;
  title: string;
  durationMinutes: number;
  startsAt: string;
  endsAt: string;
  status: "UPCOMING" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED";
  slot: Slot | null;
  activeAttemptId: string | null;
  deadlineAt: string | null;
};
type ExamDetail = Exam & {
  instructions: string;
  rules: { statements: string[]; totalMarks: number };
};

const statusLabels = {
  UPCOMING: "Upcoming",
  AVAILABLE: "Available",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

function lobbyPath(id: string) {
  return "/candidate/exam/" + encodeURIComponent(id) + "/lobby";
}

function date(value: string) {
  return new Date(value).toLocaleString();
}

function errorText(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "The examination service is unavailable.";
}

export function LiveCandidateExams() {
  const router = useRouter();
  const [rows, setRows] = useState<Exam[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [clock, setClock] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    const controller = new AbortController();
    api<Exam[]>("/me/exams?page=" + page + "&pageSize=" + pageSize, {
      signal: controller.signal,
    })
      .then(({ data, meta }) => {
        if (controller.signal.aborted) return;
        setRows(data);
        setTotal(typeof meta?.total === "number" ? meta.total : data.length);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, retry]);

  useEffect(() => {
    if (!blockedUntil) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now >= blockedUntil) setBlockedUntil(0);
      setClock(now);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [blockedUntil]);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (joining || Date.now() < blockedUntil) return;
    setJoining(true);
    setJoinError("");
    try {
      const { data } = await api<{ examId: string }>("/me/exams/join", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      router.push(lobbyPath(data.examId));
    } catch (cause) {
      setJoinError(errorText(cause));
      if (cause instanceof ApiError && cause.retryAfter) {
        const now = Date.now();
        setClock(now);
        setBlockedUntil(now + cause.retryAfter * 1000);
      }
    } finally {
      setJoining(false);
    }
  }

  function changePage(next: number) {
    setError("");
    setLoading(true);
    if (next === page) setRetry((value) => value + 1);
    else setPage(next);
  }

  const waitSeconds = Math.ceil(Math.max(0, blockedUntil - clock) / 1000);
  return (
    <>
      <Panel title="Join an examination">
        <form onSubmit={join}>
          <Field label="Exam join code">
            <input
              required
              value={code}
              maxLength={100}
              autoComplete="off"
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          {joinError && (
            <p role="alert" className="danger">
              {joinError}
            </p>
          )}
          <Button type="submit" disabled={joining || waitSeconds > 0}>
            {waitSeconds > 0
              ? "Try again in " + waitSeconds + "s"
              : "Join examination"}
          </Button>
        </form>
      </Panel>
      <Panel title="My examinations">
        {loading && <p role="status">Loading examinations…</p>}
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        {error && (
          <Button secondary onClick={() => changePage(page)}>
            Retry
          </Button>
        )}
        {!loading && !error && rows.length === 0 && (
          <p>You are not enrolled in any examinations yet.</p>
        )}
        {!loading &&
          rows.map((exam) => (
            <article key={exam.id} className="panel">
              <h3>{exam.title}</h3>
              <Badge>{statusLabels[exam.status]}</Badge>
              <p>
                {date(exam.slot?.startsAt ?? exam.startsAt)} to{" "}
                {date(exam.slot?.endsAt ?? exam.endsAt)} ·{" "}
                {exam.durationMinutes} minutes
              </p>
              <Button secondary to={lobbyPath(exam.id)}>
                View examination
              </Button>
            </article>
          ))}
        {!loading && total > pageSize && (
          <div className="actions">
            <Button
              secondary
              disabled={page <= 1}
              onClick={() => changePage(page - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              secondary
              disabled={page * pageSize >= total}
              onClick={() => changePage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}

export function LiveCandidateLobby() {
  const { id } = useParams<{ id: string }>();
  const [exam, setExam] = useState<ExamDetail>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<ExamDetail>("/me/exams/" + encodeURIComponent(id), {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!controller.signal.aborted) setExam(data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    return () => controller.abort();
  }, [id]);

  return (
    <>
      <Heading
        title={exam?.title ?? "Examination"}
        actions={
          <Button secondary to="/candidate">
            My workspace
          </Button>
        }
      />
      {error && (
        <p role="alert" className="danger">
          {error}
        </p>
      )}
      {!exam && !error && <p role="status">Loading examination…</p>}
      {exam && (
        <Panel title="Instructions and rules">
          <Badge>{statusLabels[exam.status]}</Badge>
          <p style={{ whiteSpace: "pre-wrap" }}>{exam.instructions}</p>
          <p>
            {date(exam.slot?.startsAt ?? exam.startsAt)} to{" "}
            {date(exam.slot?.endsAt ?? exam.endsAt)}
          </p>
          <p>
            {exam.durationMinutes} minutes · {exam.rules.totalMarks} marks
          </p>
          {exam.rules.statements.length > 0 && (
            <ul>
              {exam.rules.statements.map((statement, index) => (
                <li key={index}>{statement}</li>
              ))}
            </ul>
          )}
          {exam.status === "AVAILABLE" && (
            <p>Taking an examination from this workspace is coming soon.</p>
          )}
        </Panel>
      )}
    </>
  );
}
