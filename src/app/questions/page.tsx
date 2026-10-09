import PageShell from "@/components/PageShell";
import QuestionBank from "@/components/QuestionBank";
import { requireUser } from "@/lib/authz";
import { listQuestions } from "@/lib/questions";

export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const user = await requireUser();
  const questions = await listQuestions(user);
  return (
    <PageShell>
      <h1 className="page-title mb-4">Database soal</h1>
      <QuestionBank initial={questions} />
    </PageShell>
  );
}
