import { withAuth } from "@workos-inc/authkit-nextjs";
import ProjectPicker from "@/components/ProjectPicker";

export default async function ProjectsPage() {
  const { user } = await withAuth({ ensureSignedIn: true });

  return (
    <ProjectPicker
      userEmail={user.email}
      userName={[user.firstName, user.lastName].filter(Boolean).join(" ") || null}
      signOutUrl="/api/signout"
    />
  );
}
