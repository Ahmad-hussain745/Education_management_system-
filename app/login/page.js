import { Suspense } from "react";
import LoginForm from "./LoginForm";

// LoginForm reads ?deactivated=1 via useSearchParams(), which Next.js
// requires to be wrapped in Suspense — without this the production build
// fails to prerender this page at all (a hard build error, not a warning).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
