# Running your Uniqus app on your own infrastructure

This is the how-to for a customer who wants to run the app Uniqus built on
**their own** infrastructure — their CI/CD, their container registry, their
Kubernetes or VMs — instead of Uniqus's built-in public-cloud deploy button
(Vercel). Common for finance, GRC, regulated, or air-gapped buyers.

**The short version:** your generated app is ordinary source code with no
runtime dependency on Uniqus services, so you can package it however your
platform standardizes on (a container, a VM image, whatever) and run it
anywhere. There are three honest paths below, plus one important scope note at
the end.

For where this sits in the broader stack/limits picture, see
[`docs/supported-stacks-and-limits.md`](./supported-stacks-and-limits.md).

---

## Path 1 — GitHub publish → your own CI/CD

The lowest-friction option if you already have a deployment pipeline.

1. Connect GitHub in Uniqus and use **Publish to GitHub**. Uniqus creates a
   repo on your account (private by default) and pushes the project's **full
   source**. (`createUserRepo` and the initial push live in
   [`services/orchestrator/src/github.ts`](../services/orchestrator/src/github.ts).)
2. The repo is now yours. Point your existing CI/CD (GitHub Actions, GitLab CI,
   Jenkins, Argo, Spinnaker, …) at it and deploy the way you already deploy
   everything else.

You own the repo, the secrets, and the pipeline. Uniqus is out of the loop once
the code is pushed.

---

## Path 2 — Download the code → add your own Dockerfile → your registry → your infra

Use this when you want a self-contained artifact and don't want to route through
GitHub, or when your registry/cluster is the system of record.

### 2a. Get the code out

The simplest export is a **`.zip` of the project**:

```bash
# Download the project as a zip (auth header omitted for brevity)
curl -L -o myapp.zip \
  "https://api2.uniqus-code.com/api/projects/<PROJECT_ID>/export.zip"
unzip myapp.zip -d myapp
cd myapp
```

> Note: `GET /api/projects/:id/export.zip` is the simplest "get your code out"
> endpoint. If your build of Uniqus doesn't expose it yet, use **Path 1**
> (GitHub publish) to obtain the same source — the code is identical.

### 2b. Add a Dockerfile (+ .dockerignore)

Uniqus does **not** currently auto-generate a `Dockerfile`, `.dockerignore`, or
`docker-compose.yml` for a project. An earlier build had a per-shape generator
tied to a built-in Fly.io deploy adapter; both the adapter and the generator
were removed, so there's nothing to reuse here today. The exported zip is
plain source for whatever stack the project is in — write a standard
Dockerfile for that stack the way you would for any non-Uniqus app, e.g.:

| Project stack | A reasonable base image | Listens on |
| --- | --- | --- |
| Node (incl. Next.js/Vite) | `node:20-slim` | `PORT` (pick a default, e.g. `8080`) |
| Python | `python:3.11-slim` | `PORT` |
| Go | `golang:1.22-alpine` → a slim runtime stage (multi-stage) | `PORT` |
| Static (no server) | `nginx:alpine` | `80` |

If your platform team already has standard base images/Dockerfiles for these
stacks, use those — there's nothing Uniqus-specific to preserve or strip out.

A representative `docker-compose.yml` for a Node app (adjust the port for a
`static` app, which exposes `80`):

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: <your-registry>/myapp:latest
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
    env_file:
      - .env        # your secrets — NOT committed; see .dockerignore
    restart: unless-stopped
```

### 2c. Build, push, run

```bash
# Build the image from the Dockerfile you added in 2b
docker build -t <your-registry>/myapp:latest .

# (optional) smoke-test locally with compose
docker compose up --build        # app on http://localhost:8080

# Push to YOUR registry
docker push <your-registry>/myapp:latest
```

Then run it wherever you run containers. For Kubernetes:

```bash
kubectl create deployment myapp --image=<your-registry>/myapp:latest
kubectl set env deployment/myapp PORT=8080
kubectl expose deployment myapp --port=80 --target-port=8080
# add your own Ingress / Service type / secrets as usual
```

For a plain VM with Docker installed, `docker compose up -d` from the project
directory is enough.

**Secrets:** the zip you downloaded in 2a already has `.env` / `.env.*` stripped
out (Uniqus's export path excludes them before the code ever leaves the
server — `isSecretEnvFile` in
[`services/orchestrator/src/deploy.ts`](../services/orchestrator/src/deploy.ts),
shared with the Vercel deploy pipeline; `.env.example` and similar templates
are kept), so nothing sensitive rides along in the source. Add the same
pattern to your own `.dockerignore` before building, and inject real values at
runtime the way your platform already does — compose `env_file`, Kubernetes
`Secret`s, your secrets manager, etc.

---

## Path 3 — the in-product Vercel deploy is *public* cloud, not private-cloud

Uniqus has a built-in one-click **Deploy to Vercel**
([`services/orchestrator/src/deploy.ts`](../services/orchestrator/src/deploy.ts)),
and it's genuinely useful — but be clear about what it is:

- It pushes your project's files to **Vercel's public infrastructure** via
  Vercel's Files API; Vercel detects the framework from `package.json` and
  builds it there. There is no Docker build in this path at all.
- It therefore **does not, by itself, satisfy a "must run on our own infra"
  requirement.** For private cloud / air-gapped, use **Path 1** or **Path 2**.

Because this path never touches Docker, there's no shared artifact to carry
over into Path 2 — the Dockerfile you write there (2b) is independent of what
the in-product deploy button does. (An earlier build also had a Fly.io deploy
adapter for long-running-container apps; it has been removed and is no longer
offered.)

---

## Scope: what is NOT offered today (honest answer)

Only the **app Uniqus generates** is portable. **Self-hosting or air-gapping the
Uniqus Code control plane itself** — the orchestrator, the Firecracker microVM
fleet, and the web app — is **not offered today**.

In practice that means: you can run *your app* entirely on your own
infrastructure, but the *builder* (where you chat with the agent and it edits
code in a sandbox) still runs on Uniqus-hosted infrastructure.

This is a **packaging-and-documentation gap, not a fundamental inability to
leave Vercel**. The generated app is already plain code with no runtime tie to
Uniqus services — that's why Paths 1 and 2 work cleanly (Path 2 just means
writing an ordinary Dockerfile for the stack, same as for any non-Uniqus app).
If full control-plane self-hosting is a hard requirement for your evaluation,
raise it explicitly; it's a roadmap conversation, and we'd rather tell you that
than ship a band-aid that looks done.
