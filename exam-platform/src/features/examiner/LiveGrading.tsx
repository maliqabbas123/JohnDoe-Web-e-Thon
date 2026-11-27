"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Heading, Panel } from "@/components/shared";
import { api } from "@/lib/api";
import { LiveExamNav } from "./LiveExamNav";

type QueueItem = {
  attemptId: string;
  position: number;
  submittedAt: string;
  marks: number;
  candidate: { id: string; name: string };
};
type AttemptGrade = {
  id: string;
  gradingStatus: "NEEDS_REVIEW" | "GRADED";
  score: number | null;
};
type ReviewQuestion = {
  position: number;
  type: "SINGLE_CHOICE" | "MULTIPLE_SELECT" | "WRITTEN";
  text: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  selectedOptionIds: string[];
  writtenAnswer: string | null;
  marks: number;
  score: number | null;
  manualScore: number | null;
  feedback: string | null;
  gradedAt: string | null;
  voided: boolean;
};
type Review = AttemptGrade & {
  exam: { id: string; title: string };
  candidate: QueueItem["candidate"];
  attemptNumber: number;
  submittedAt: string;
  resultReleasedAt: string | null;
  maxScore: number;
  questions: ReviewQuestion[];
};
type SavedGrade = {
  attempt: AttemptGrade;
  answer: Pick<
    ReviewQuestion,
    "position" | "manualScore" | "feedback" | "gradedAt"
  >;
};

function errorText(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "The examination service is unavailable.";
}

export function LiveGradingQueue() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api<QueueItem[]>("/exams/" + encodeURIComponent(id) + "/grading", {
      signal: controller.signal,
    })
      .then(({ data, meta }) => {
        if (controller.signal.aborted) return;
        setItems(data);
        setCursor(
          typeof meta?.nextCursor === "string" ? meta.nextCursor : undefined,
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [id, retry]);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ cursor });
      const { data, meta } = await api<QueueItem[]>(
        "/exams/" + encodeURIComponent(id) + "/grading?" + query,
      );
      setItems((previous) => [...previous, ...data]);
      setCursor(
        typeof meta?.nextCursor === "string" ? meta.nextCursor : undefined,
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading
        title="Grading queue"
        actions={
          <Button secondary to="/examiner">
            My examinations
          </Button>
        }
      />
      <LiveExamNav id={id} current="grading" />
      <Panel>
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        {busy && <p role="status">Loading submissions…</p>}
        {!busy && error && !cursor && (
          <Button
            secondary
            onClick={() => {
              setError("");
              setBusy(true);
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </Button>
        )}
        {!busy && !error && items.length === 0 && (
          <p>No written answers are waiting for grading.</p>
        )}
        {items.length > 0 && (
          <ul>
            {items.map((item) => (
              <li key={item.attemptId + ":" + item.position}>
                <Link
                  href={
                    "/examiner/exams/" +
                    encodeURIComponent(id) +
                    "/submissions/" +
                    encodeURIComponent(item.attemptId) +
                    "?position=" +
                    item.position
                  }
                >
                  {item.candidate.name} · Question {item.position} ·{" "}
                  {item.marks} marks
                </Link>
                <div>
                  <small>{new Date(item.submittedAt).toLocaleString()}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <Button secondary disabled={busy} onClick={loadMore}>
            Load more
          </Button>
        )}
      </Panel>
    </>
  );
}

function WrittenGrade({
  question,
  released,
  save,
}: {
  question: ReviewQuestion;
  released: boolean;
  save: (
    score: number,
    feedback: string | null,
    reason?: string,
  ) => Promise<void>;
}) {
  const [score, setScore] = useState(question.manualScore?.toString() ?? "");
  const [feedback, setFeedback] = useState(question.feedback ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const needsReason =
    released && score !== "" && Number(score) !== question.manualScore;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await save(
        Number(score),
        feedback.trim() ? feedback : null,
        needsReason ? reason.trim() : undefined,
      );
      setReason("");
      setNotice("Grade saved.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {question.writtenAnswer ?? "No answer submitted."}
      </p>
      <form onSubmit={submit}>
        <Field label={"Mark out of " + question.marks}>
          <input
            type="number"
            min={0}
            max={question.marks}
            step="0.01"
            required
            value={score}
            onChange={(event) => setScore(event.target.value)}
          />
        </Field>
        <Field label="Feedback">
          <textarea
            maxLength={5000}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </Field>
        {needsReason && (
          <Field label="Reason for changing the released mark">
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <Button type="submit" disabled={busy}>
          Save grade
        </Button>
      </form>
    </>
  );
}

export function LiveSubmissionReview() {
  const { id, attemptId } = useParams<{ id: string; attemptId: string }>();
  const search = useSearchParams();
  const initialPosition = Number(search.get("position"));
  const [position, setPosition] = useState(initialPosition);
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState("");
  const endpoint = "/attempts/" + encodeURIComponent(attemptId);

  useEffect(() => {
    const controller = new AbortController();
    api<Review>(endpoint + "/review", { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (data.exam.id !== id) {
          setError("This attempt does not belong to this examination.");
          return;
        }
        setReview(data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    return () => controller.abort();
  }, [endpoint, id]);

  async function save(
    question: ReviewQuestion,
    score: number,
    feedback: string | null,
    reason?: string,
  ) {
    const { data } = await api<SavedGrade>(
      endpoint + "/answers/" + question.position + "/grade",
      {
        method: "PATCH",
        body: JSON.stringify({ score, feedback, reason }),
      },
    );
    setReview(
      (current) =>
        current && {
          ...current,
          ...data.attempt,
          questions: current.questions.map((item) =>
            item.position === question.position
              ? {
                  ...item,
                  ...data.answer,
                  score: item.voided ? item.score : data.answer.manualScore,
                }
              : item,
          ),
        },
    );
  }

  const selected =
    review?.questions.find((item) => item.position === position) ??
    review?.questions[0];
  return (
    <>
      <Heading
        title="Review submission"
        subtitle={review?.exam.title}
        actions={
          <Button
            secondary
            to={"/examiner/exams/" + encodeURIComponent(id) + "/grading"}
          >
            Grading queue
          </Button>
        }
      />
      {error && (
        <p role="alert" className="danger">
          {error}
        </p>
      )}
      {!error && !review && <p role="status">Loading submission…</p>}
      {review && (
        <Panel title={review.candidate.name}>
          <p>
            Attempt {review.attemptNumber} ·{" "}
            {review.score === null
              ? "Awaiting marks"
              : review.score + " / " + review.maxScore}
          </p>
          <Field label="Question">
            <select
              value={selected?.position ?? ""}
              onChange={(event) => setPosition(Number(event.target.value))}
            >
              {review.questions.map((item) => (
                <option key={item.position} value={item.position}>
                  Question {item.position}
                </option>
              ))}
            </select>
          </Field>
          {selected && (
            <>
              <h3>{selected.text}</h3>
              {selected.voided && <p>Voided question</p>}
              {selected.type === "WRITTEN" ? (
                <WrittenGrade
                  key={selected.position}
                  question={selected}
                  released={review.resultReleasedAt !== null}
                  save={(score, feedback, reason) =>
                    save(selected, score, feedback, reason)
                  }
                />
              ) : (
                <ul>
                  {selected.options.map((option) => (
                    <li key={option.id}>
                      {option.text}
                      {option.isCorrect ? " · Correct" : ""}
                      {selected.selectedOptionIds.includes(option.id)
                        ? " · Selected"
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
      )}
    </>
  );
}
