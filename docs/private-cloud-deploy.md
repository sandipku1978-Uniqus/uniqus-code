# Running your Uniqus app on your own infrastructure

This is the how-to for a customer who wants to run the app Uniqus built on
**their own** infrastructure — their CI/CD, their container registry, their
Kubernetes or VMs — instead of public Vercel or Fly.io. Common for finance,
GRC, regulated, or air-gapped buyers.

**The short version:** your generated app is ordinary source code plus a
standard Dockerfile. There is no runtime dependency on Uniqus services in the
app itself, so you can take it anywhere a container runs. There are three honest
paths below, plus one important scope note at the end.

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

## Path 2 — Download the code + deploy bundle → build → your registry → your infra

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

### 2b. Get the deploy bundle (Dockerfile + .dockerignore + docker-compose.yml)

Uniqus generates a portable, per-shape `Dockerfile` and `.dockerignore` for any
project — the same generator the Fly path uses (`renderDockerfile` /
`ensureFlyManifests` in
[`services/orchestrator/src/flyDeploy.ts`](../services/orchestrator/src/flyDeploy.ts)).
The **deploy bundle** adds a `docker-compose.yml` so your platform team can
build and run with no Uniqus or Fly account involved.

Detected shapes and base images:

| Project shape | Base image(s) | Listens on |
| --- | --- | --- |
| `node` / `node-server` | `node:20-slim` | `PORT` (default `8080`) |
| `python` | `python:3.11-slim` | `PORT` (default `8080`) |
| `go` | `golang:1.22-alpine` → `alpine:3.19` (multi-stage) | `PORT` (default `8080`) |
| `static` | `nginx:alpine` | `80` |

If a `Dockerfile` / `.dockerignore` is already present in the project they are
left untouched; Uniqus only fills in what's missing.

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
# Build the image from the generated Dockerfile
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

**Secrets:** the generated `.dockerignore` excludes `.env` / `.env.*` (keeping
`.env.example`) so secrets are never baked into the image. Inject them at runtime
the way your platform already does — compose `env_file`, Kubernetes `Secret`s,
your secrets manager, etc.

---

## Path 3 — Fly.io is *public* cloud, not private-cloud

Uniqus has a built-in Fly.io deploy adapter, and it's genuinely useful — but be
clear about what it is:

- It builds your container and ships it to **Fly's public infrastructure**.
- It therefore **does not, by itself, satisfy a "must run on our own infra"
  requirement.** For private cloud / air-gapped, use **Path 1** or **Path 2**.

The Fly adapter is still helpful as a reference: it generates the exact same
`Dockerfile` your team will reuse in Path 2 (`renderDockerfile` in
[`services/orchestrator/src/flyDeploy.ts`](../services/orchestrator/src/flyDeploy.ts)),
so you can validate the build on Fly first and then move the identical image to
your own registry/cluster.

---

## Scope: what is NOT offered today (honest answer)

Only the **app Uniqus generates** is portable. **Self-hosting or air-gapping the
Uniqus Code control plane itself** — the orchestrator, the Firecracker microVM
fleet, and the web app — is **not offered today**.

In practice that means: you can run *your app* entirely on your own
infrastructure, but the *builder* (where you chat with the agent and it edits
code in a sandbox) still runs on Uniqus-hosted infrastructure.

This is a **packaging-and-documentation gap, not a fundamental inability to
leave Vercel**. The generated app is already plain code plus a standard,
provider-agnostic Dockerfile with no runtime tie to Uniqus services — that's
why Paths 1 and 2 work cleanly. If full control-plane self-hosting is a hard
requirement for your evaluation, raise it explicitly; it's a roadmap
conversation, and we'd rather tell you that than ship a band-aid that looks done.
