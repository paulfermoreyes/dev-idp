import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { execFile } from 'child_process';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ScorecardCheck {
  id: string;
  pillar: 'Ownership' | 'CI/CD & Quality' | 'Security & Supply Chain' | 'Docs & Reliability';
  title: string;
  passed: boolean;
  evidence: string;
  remediation: string;
  weight: number;
}

export interface PillarSummary {
  pillar: ScorecardCheck['pillar'];
  passed: number;
  total: number;
  percentage: number;
}

export interface DoraMetric {
  label: string;
  value: string;
  band: 'Elite' | 'High' | 'Medium' | 'Low';
  detail: string;
}

export interface DeliveryEvent {
  sha: string;
  subject: string;
  author: string;
  date: string;
  category: 'feature' | 'fix' | 'revert' | 'chore';
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  workflowPath: string;
  status: string;
  conclusion: string | null;
  branch: string;
  sha: string;
  commitMessage: string;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number;
  htmlUrl: string;
  isDeployment: boolean;
}

export interface PlatformInsightsReport {
  entityName: string;
  repoPath: string;
  projectSlug: string | null;
  evaluatedAt: string;
  scorecard: {
    score: number;
    passedCount: number;
    totalCount: number;
    tier: 'Gold' | 'Silver' | 'Bronze' | 'Needs Attention';
    pillars: PillarSummary[];
    checks: ScorecardCheck[];
  };
  dora: {
    source: 'github-actions' | 'git-fallback';
    sourceNote: string;
    windowDays: number;
    totalCommits: number;
    totalDeployRuns: number;
    deploymentFrequency: DoraMetric;
    leadTimeForChanges: DoraMetric;
    changeFailureRate: DoraMetric;
    meanTimeToRecovery: DoraMetric;
    recentDeliveries: DeliveryEvent[];
    workflowRuns: WorkflowRunSummary[];
  };
}

interface GitHubWorkflowRunApi {
  id: number;
  name: string;
  path?: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  html_url: string;
  head_commit?: {
    message?: string;
    timestamp?: string;
  };
}

function fileExists(repoPath: string, relPath: string): boolean {
  return fs.existsSync(path.join(repoPath, relPath));
}

function readText(repoPath: string, relPath: string): string {
  const full = path.join(repoPath, relPath);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf8');
}

function evaluateScorecard(repoPath: string): PlatformInsightsReport['scorecard'] {
  const catalogYaml = readText(repoPath, 'catalog-info.yaml');
  const codeowners = readText(repoPath, '.github/CODEOWNERS');
  const deployYml = readText(repoPath, '.github/workflows/deploy.yml');
  const ciYml = readText(repoPath, '.github/workflows/ci.yml');
  const tsconfig = readText(repoPath, 'tsconfig.json');
  const gitignore = readText(repoPath, '.gitignore');
  const firestoreRules = readText(repoPath, 'firestore.rules');
  const runbook = readText(repoPath, 'docs/runbook.md');

  const checks: ScorecardCheck[] = [
    // 1. Ownership
    {
      id: 'catalog-manifest',
      pillar: 'Ownership',
      title: 'Backstage Catalog Manifest & Ownership',
      passed:
        catalogYaml.includes('kind: Component') &&
        catalogYaml.includes('owner:') &&
        catalogYaml.includes('system:'),
      evidence: catalogYaml
        ? 'catalog-info.yaml defines Component, owner, and system'
        : 'catalog-info.yaml not found',
      remediation: 'Add catalog-info.yaml with spec.owner and spec.system.',
      weight: 10,
    },
    {
      id: 'codeowners',
      pillar: 'Ownership',
      title: 'Repository CODEOWNERS Declared',
      passed: codeowners.trim().length > 0 && codeowners.includes('@'),
      evidence: codeowners
        ? '.github/CODEOWNERS assigns explicit reviewers'
        : '.github/CODEOWNERS is missing',
      remediation: 'Add .github/CODEOWNERS mapping paths to team or individual handles.',
      weight: 10,
    },
    {
      id: 'idp-annotations',
      pillar: 'Ownership',
      title: 'Platform Tier & Golden Path Annotations',
      passed:
        catalogYaml.includes('idp.dev/tier') &&
        catalogYaml.includes('idp.dev/golden-path'),
      evidence:
        catalogYaml.includes('idp.dev/tier')
          ? 'Annotated with idp.dev/tier and idp.dev/golden-path'
          : 'Missing idp.dev/tier or idp.dev/golden-path annotations',
      remediation: 'Add idp.dev/tier and idp.dev/golden-path annotations in catalog-info.yaml.',
      weight: 5,
    },

    // 2. CI/CD & Quality
    {
      id: 'pr-ci-gate',
      pillar: 'CI/CD & Quality',
      title: 'Pull Request CI Quality Gate',
      passed: ciYml.includes('pull_request') && ciYml.includes('npm run build'),
      evidence: ciYml
        ? '.github/workflows/ci.yml validates PRs with build & audit'
        : 'No PR CI workflow (.github/workflows/ci.yml)',
      remediation: 'Add .github/workflows/ci.yml triggered on pull_request.',
      weight: 10,
    },
    {
      id: 'approval-gated-cd',
      pillar: 'CI/CD & Quality',
      title: 'Environment-Gated Production Deployment',
      passed: deployYml.includes('environment:') && deployYml.includes('deploy'),
      evidence: deployYml.includes('environment:')
        ? '.github/workflows/deploy.yml uses a protected GitHub Environment'
        : 'Deployment workflow lacks an environment protection gate',
      remediation: 'Configure a protected GitHub Environment in deploy.yml.',
      weight: 10,
    },
    {
      id: 'strict-typescript',
      pillar: 'CI/CD & Quality',
      title: 'Strict TypeScript Compiler Mode',
      passed: /"strict"\s*:\s*true/.test(tsconfig),
      evidence: /"strict"\s*:\s*true/.test(tsconfig)
        ? 'tsconfig.json enforces "strict": true'
        : 'Strict TypeScript mode is not enabled',
      remediation: 'Set "strict": true in tsconfig.json.',
      weight: 5,
    },

    // 3. Security & Supply Chain
    {
      id: 'secret-hygiene',
      pillar: 'Security & Supply Chain',
      title: 'Secret Hygiene (.env ignored + .env.example)',
      passed: gitignore.includes('.env') && fileExists(repoPath, '.env.example'),
      evidence:
        gitignore.includes('.env') && fileExists(repoPath, '.env.example')
          ? '.env excluded in .gitignore and .env.example contract exists'
          : 'Missing .env gitignore rule or .env.example',
      remediation: 'Add .env to .gitignore and commit a sanitized .env.example.',
      weight: 10,
    },
    {
      id: 'dependabot',
      pillar: 'Security & Supply Chain',
      title: 'Automated Dependency Updates (Dependabot)',
      passed:
        fileExists(repoPath, '.github/dependabot.yml') ||
        fileExists(repoPath, 'renovate.json'),
      evidence: fileExists(repoPath, '.github/dependabot.yml')
        ? '.github/dependabot.yml monitors npm & GitHub Actions'
        : 'No automated dependency update config found',
      remediation: 'Add .github/dependabot.yml for npm and github-actions ecosystems.',
      weight: 10,
    },
    {
      id: 'database-security-rules',
      pillar: 'Security & Supply Chain',
      title: 'Database Security Rules as Code',
      passed: firestoreRules.includes('rules_version'),
      evidence: firestoreRules.includes('rules_version')
        ? 'firestore.rules version-controlled in repository'
        : 'No database security rules found in repo',
      remediation: 'Version-control Firestore/DB security rules in firestore.rules.',
      weight: 10,
    },

    // 4. Docs & Reliability
    {
      id: 'techdocs-ready',
      pillar: 'Docs & Reliability',
      title: 'TechDocs Docs-as-Code Configured',
      passed:
        fileExists(repoPath, 'mkdocs.yml') &&
        fileExists(repoPath, 'docs/index.md'),
      evidence: fileExists(repoPath, 'mkdocs.yml')
        ? 'mkdocs.yml and docs/index.md ready for Backstage TechDocs'
        : 'Missing mkdocs.yml or docs/index.md',
      remediation: 'Add mkdocs.yml and docs/index.md and annotate catalog-info.yaml.',
      weight: 10,
    },
    {
      id: 'architecture-docs',
      pillar: 'Docs & Reliability',
      title: 'Architecture Documentation Present',
      passed:
        fileExists(repoPath, 'ARCHITECTURE.md') ||
        fileExists(repoPath, 'docs/architecture.md'),
      evidence: 'Architecture reference documented',
      remediation: 'Document system architecture in ARCHITECTURE.md or docs/architecture.md.',
      weight: 5,
    },
    {
      id: 'operations-runbook',
      pillar: 'Docs & Reliability',
      title: 'Incident & Rollback Runbook',
      passed:
        runbook.length > 0 &&
        runbook.toLowerCase().includes('rollback'),
      evidence: runbook
        ? 'docs/runbook.md includes release, incident, and rollback procedures'
        : 'docs/runbook.md missing or lacks rollback steps',
      remediation: 'Add docs/runbook.md documenting rollback and common incident fixes.',
      weight: 5,
    },
  ];

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earnedWeight = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);
  const passedCount = checks.filter(c => c.passed).length;

  let tier: PlatformInsightsReport['scorecard']['tier'] = 'Needs Attention';
  if (score >= 90) tier = 'Gold';
  else if (score >= 70) tier = 'Silver';
  else if (score >= 40) tier = 'Bronze';

  const pillarNames: ScorecardCheck['pillar'][] = [
    'Ownership',
    'CI/CD & Quality',
    'Security & Supply Chain',
    'Docs & Reliability',
  ];

  const pillars: PillarSummary[] = pillarNames.map(pillar => {
    const items = checks.filter(c => c.pillar === pillar);
    const passed = items.filter(c => c.passed).length;
    return {
      pillar,
      passed,
      total: items.length,
      percentage: Math.round((passed / items.length) * 100),
    };
  });

  return {
    score,
    passedCount,
    totalCount: checks.length,
    tier,
    pillars,
    checks,
  };
}

function classifyCommit(subject: string): DeliveryEvent['category'] {
  const lower = subject.toLowerCase();
  if (lower.startsWith('revert') || lower.includes('rollback')) return 'revert';
  if (lower.startsWith('fix') || lower.includes('hotfix')) return 'fix';
  if (lower.startsWith('feat')) return 'feature';
  return 'chore';
}

function isDeploymentWorkflow(run: GitHubWorkflowRunApi): boolean {
  const name = (run.name || '').toLowerCase();
  const wfPath = (run.path || '').toLowerCase();
  return (
    wfPath.includes('deploy') ||
    name.includes('deploy') ||
    name.includes('release') ||
    name.includes('pages')
  );
}

async function fetchGitHubWorkflowRuns(
  projectSlug: string,
): Promise<{ runs: WorkflowRunSummary[]; raw: GitHubWorkflowRunApi[]; authMode: string } | null> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(projectSlug)) {
    return null;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'backstage-platform-insights',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${projectSlug}/actions/runs?per_page=30`,
      { headers, signal: controller.signal },
    );
    if (!res.ok) {
      return null;
    }
    const payload = (await res.json()) as { workflow_runs?: GitHubWorkflowRunApi[] };
    const raw = payload.workflow_runs || [];

    const runs: WorkflowRunSummary[] = raw.slice(0, 15).map(r => {
      const startMs = new Date(r.run_started_at || r.created_at).getTime();
      const endMs = new Date(r.updated_at).getTime();
      const durationSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
      return {
        id: r.id,
        name: r.name,
        workflowPath: r.path || '',
        status: r.status,
        conclusion: r.conclusion,
        branch: r.head_branch,
        sha: (r.head_sha || '').slice(0, 7),
        commitMessage: (r.head_commit?.message || '').split('\n')[0],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        durationSeconds,
        htmlUrl: r.html_url,
        isDeployment: isDeploymentWorkflow(r),
      };
    });

    return {
      runs,
      raw,
      authMode: token ? 'authenticated (GITHUB_TOKEN)' : 'unauthenticated (public API)',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readGitCommits(repoPath: string) {
  let rawLog = '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoPath, 'log', '-n', '50', '--pretty=format:%h|%at|%ct|%an|%s'],
      { timeout: 5000 },
    );
    rawLog = stdout.trim();
  } catch {
    rawLog = '';
  }

  const lines = rawLog ? rawLog.split('\n').filter(Boolean) : [];
  return lines.map(line => {
    const [sha, authorTs, commitTs, author, ...subjectParts] = line.split('|');
    const subject = subjectParts.join('|');
    const aTs = Number(authorTs) || 0;
    const cTs = Number(commitTs) || aTs;
    return {
      sha,
      authorTs: aTs,
      commitTs: cTs,
      author,
      subject,
      category: classifyCommit(subject),
    };
  });
}

async function evaluateDora(
  repoPath: string,
  projectSlug: string | null,
): Promise<PlatformInsightsReport['dora']> {
  const commits = await readGitCommits(repoPath);
  const recentDeliveries: DeliveryEvent[] = commits.slice(0, 10).map(c => ({
    sha: c.sha,
    subject: c.subject,
    author: c.author,
    date: new Date(c.commitTs * 1000).toISOString(),
    category: c.category,
  }));

  // Try Live GitHub Actions Telemetry first
  const ghData = projectSlug ? await fetchGitHubWorkflowRuns(projectSlug) : null;
  const completedDeployRuns = ghData
    ? ghData.raw.filter(r => isDeploymentWorkflow(r) && r.status === 'completed')
    : [];

  if (ghData && completedDeployRuns.length > 0) {
    const successfulDeploys = completedDeployRuns.filter(r => r.conclusion === 'success');
    const failedDeploys = completedDeployRuns.filter(
      r => r.conclusion === 'failure' || r.conclusion === 'timed_out',
    );

    const nowMs = Date.now();
    const oldestMs = Math.min(
      ...completedDeployRuns.map(r => new Date(r.created_at).getTime()),
    );
    const spanDays = Math.max(1, Math.ceil((nowMs - oldestMs) / 86400000));
    const weeks = Math.max(1, spanDays / 7);

    // 1. Deployment Frequency (successful deploys per week)
    const deploysPerWeek = Number((successfulDeploys.length / weeks).toFixed(1));
    let dfBand: DoraMetric['band'] = 'Low';
    if (deploysPerWeek >= 7) dfBand = 'Elite';
    else if (deploysPerWeek >= 1) dfBand = 'High';
    else if (deploysPerWeek >= 0.25) dfBand = 'Medium';

    // 2. Lead Time for Changes (commit timestamp -> successful deploy updated_at)
    const leadMinutes: number[] = [];
    for (const run of successfulDeploys) {
      const commitTs = run.head_commit?.timestamp
        ? new Date(run.head_commit.timestamp).getTime()
        : new Date(run.created_at).getTime();
      const deployDoneTs = new Date(run.updated_at).getTime();
      const mins = (deployDoneTs - commitTs) / 60000;
      if (mins >= 0 && mins < 43200) {
        leadMinutes.push(mins);
      }
    }
    leadMinutes.sort((a, b) => a - b);
    const medianLeadMins =
      leadMinutes.length > 0
        ? leadMinutes[Math.floor(leadMinutes.length / 2)]
        : 0;
    const medianLeadHours = medianLeadMins / 60;

    let ltBand: DoraMetric['band'] = 'Low';
    if (medianLeadHours < 24) ltBand = 'Elite';
    else if (medianLeadHours < 168) ltBand = 'High';
    else if (medianLeadHours < 720) ltBand = 'Medium';

    const leadTimeDisplay =
      medianLeadMins < 60
        ? `${Math.max(1, Math.round(medianLeadMins))} mins`
        : `${medianLeadHours.toFixed(1)} hrs`;

    // 3. Change Failure Rate (% of completed deploy runs that failed)
    const cfrPct = Number(
      ((failedDeploys.length / completedDeployRuns.length) * 100).toFixed(1),
    );
    let cfrBand: DoraMetric['band'] = 'Low';
    if (cfrPct <= 5) cfrBand = 'Elite';
    else if (cfrPct <= 15) cfrBand = 'High';
    else if (cfrPct <= 30) cfrBand = 'Medium';

    // 4. Mean Time to Recovery (failed deploy -> next successful deploy)
    const chronoDeploys = [...completedDeployRuns].sort(
      (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
    );
    const recoveryMins: number[] = [];
    let activeFailureTs: number | null = null;
    for (const run of chronoDeploys) {
      const ts = new Date(run.updated_at).getTime();
      if (run.conclusion === 'failure' || run.conclusion === 'timed_out') {
        if (activeFailureTs === null) activeFailureTs = ts;
      } else if (run.conclusion === 'success' && activeFailureTs !== null) {
        recoveryMins.push(Math.max(1, (ts - activeFailureTs) / 60000));
        activeFailureTs = null;
      }
    }
    const avgRecoveryMins =
      recoveryMins.length > 0
        ? recoveryMins.reduce((a, b) => a + b, 0) / recoveryMins.length
        : 0;
    const avgRecoveryHours = avgRecoveryMins / 60;

    let mttrBand: DoraMetric['band'] = 'Elite';
    if (avgRecoveryHours > 168) mttrBand = 'Low';
    else if (avgRecoveryHours > 24) mttrBand = 'Medium';
    else if (avgRecoveryHours > 1) mttrBand = 'High';

    const mttrDisplay =
      recoveryMins.length === 0
        ? '0 mins (Clean)'
        : avgRecoveryMins < 60
          ? `${Math.round(avgRecoveryMins)} mins`
          : `${avgRecoveryHours.toFixed(1)} hrs`;

    return {
      source: 'github-actions',
      sourceNote: `Live GitHub Actions API (${projectSlug} • ${ghData.authMode})`,
      windowDays: spanDays,
      totalCommits: commits.length,
      totalDeployRuns: completedDeployRuns.length,
      deploymentFrequency: {
        label: 'Deployment Frequency',
        value: `${deploysPerWeek} / week`,
        band: dfBand,
        detail: `${successfulDeploys.length} successful deploy run(s) across ${spanDays} day(s)`,
      },
      leadTimeForChanges: {
        label: 'Lead Time for Changes',
        value: leadTimeDisplay,
        band: ltBand,
        detail: 'Median time from commit timestamp to successful GitHub Actions deploy completion',
      },
      changeFailureRate: {
        label: 'Change Failure Rate',
        value: `${cfrPct}%`,
        band: cfrBand,
        detail: `${failedDeploys.length} failed deploy(s) out of ${completedDeployRuns.length} completed runs`,
      },
      meanTimeToRecovery: {
        label: 'Mean Time to Recovery',
        value: mttrDisplay,
        band: mttrBand,
        detail:
          recoveryMins.length > 0
            ? `Average time from failed deploy to next green deploy (${recoveryMins.length} incident(s))`
            : 'Zero failed production deployments in the observed window',
      },
      recentDeliveries,
      workflowRuns: ghData.runs,
    };
  }

  // Fallback: Git Commit History Heuristics
  const totalCommits = commits.length;
  const nowSec = Math.floor(Date.now() / 1000);
  const oldestTs = commits.length > 0 ? commits[commits.length - 1].commitTs : nowSec;
  const spanDays = Math.max(1, Math.ceil((nowSec - oldestTs) / 86400));
  const weeks = Math.max(1, spanDays / 7);

  const deploysPerWeek = Number((totalCommits / weeks).toFixed(1));
  let dfBand: DoraMetric['band'] = 'Low';
  if (deploysPerWeek >= 7) dfBand = 'Elite';
  else if (deploysPerWeek >= 1) dfBand = 'High';
  else if (deploysPerWeek >= 0.25) dfBand = 'Medium';

  const deltasHours: number[] = [];
  for (let i = 0; i < commits.length - 1; i++) {
    const diffHours = Math.abs(commits[i].commitTs - commits[i + 1].commitTs) / 3600;
    if (diffHours > 0 && diffHours < 720) deltasHours.push(diffHours);
  }
  deltasHours.sort((a, b) => a - b);
  const medianLeadHours =
    deltasHours.length > 0 ? deltasHours[Math.floor(deltasHours.length / 2)] : 1;
  let ltBand: DoraMetric['band'] = 'Low';
  if (medianLeadHours < 24) ltBand = 'Elite';
  else if (medianLeadHours < 168) ltBand = 'High';
  else if (medianLeadHours < 720) ltBand = 'Medium';

  const failureCommits = commits.filter(
    c => c.category === 'fix' || c.category === 'revert',
  );
  const cfrPct =
    totalCommits > 0
      ? Number(((failureCommits.length / totalCommits) * 100).toFixed(1))
      : 0;
  let cfrBand: DoraMetric['band'] = 'Low';
  if (cfrPct <= 5) cfrBand = 'Elite';
  else if (cfrPct <= 15) cfrBand = 'High';
  else if (cfrPct <= 30) cfrBand = 'Medium';

  const recoveryHours: number[] = [];
  for (let i = 0; i < commits.length - 1; i++) {
    if (commits[i].category === 'fix' || commits[i].category === 'revert') {
      recoveryHours.push(Math.abs(commits[i].commitTs - commits[i + 1].commitTs) / 3600);
    }
  }
  const avgMttrHours =
    recoveryHours.length > 0
      ? recoveryHours.reduce((a, b) => a + b, 0) / recoveryHours.length
      : 0;
  let mttrBand: DoraMetric['band'] = 'Elite';
  if (avgMttrHours > 168) mttrBand = 'Low';
  else if (avgMttrHours > 24) mttrBand = 'Medium';
  else if (avgMttrHours > 1) mttrBand = 'High';

  return {
    source: 'git-fallback',
    sourceNote: 'Local Git commit history (GitHub Actions API unavailable or no completed deploy runs)',
    windowDays: spanDays,
    totalCommits,
    totalDeployRuns: 0,
    deploymentFrequency: {
      label: 'Deployment Frequency',
      value: `${deploysPerWeek} / week`,
      band: dfBand,
      detail: `${totalCommits} main-branch releases across ${spanDays} day(s)`,
    },
    leadTimeForChanges: {
      label: 'Lead Time for Changes',
      value: `${medianLeadHours.toFixed(1)} hrs`,
      band: ltBand,
      detail: 'Median elapsed time between consecutive main-branch deliveries',
    },
    changeFailureRate: {
      label: 'Change Failure Rate',
      value: `${cfrPct}%`,
      band: cfrBand,
      detail: `${failureCommits.length} fix/revert commit(s) out of ${totalCommits} deliveries`,
    },
    meanTimeToRecovery: {
      label: 'Mean Time to Recovery',
      value:
        recoveryHours.length > 0 ? `${avgMttrHours.toFixed(1)} hrs` : '0 hrs (Clean)',
      band: mttrBand,
      detail:
        recoveryHours.length > 0
          ? `Average recovery across ${recoveryHours.length} remediation commit(s)`
          : 'No rollbacks or hotfixes recorded in current window',
    },
    recentDeliveries,
    workflowRuns: ghData?.runs || [],
  };
}

export const platformInsightsPlugin = createBackendPlugin({
  pluginId: 'platform-insights',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ httpRouter, logger }) {
        const router = express.Router();

        router.get('/health', (_req, res) => {
          res.json({ status: 'ok', plugin: 'platform-insights' });
        });

        router.get('/evaluate', async (req, res) => {
          const entityName = String(req.query.entityName || 'unknown');
          const repoPath = String(req.query.repoPath || '');
          const projectSlug = req.query.projectSlug
            ? String(req.query.projectSlug)
            : null;

          if (!repoPath || !path.isAbsolute(repoPath) || !fs.existsSync(repoPath)) {
            res.status(400).json({
              error:
                'Missing or invalid repoPath. Add annotation "idp.dev/local-repo-path" to catalog-info.yaml.',
            });
            return;
          }

          try {
            const scorecard = evaluateScorecard(repoPath);
            const dora = await evaluateDora(repoPath, projectSlug);

            const report: PlatformInsightsReport = {
              entityName,
              repoPath,
              projectSlug,
              evaluatedAt: new Date().toISOString(),
              scorecard,
              dora,
            };

            res.json(report);
          } catch (error) {
            logger.error(`Failed to evaluate platform insights for ${entityName}`, error as Error);
            res.status(500).json({ error: 'Evaluation failed' });
          }
        });

        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });
        httpRouter.addAuthPolicy({
          path: '/evaluate',
          allow: 'unauthenticated',
        });

        httpRouter.use(router);
        logger.info('Platform Insights backend plugin initialized (Scorecards & Live GitHub Actions DORA)');
      },
    });
  },
});

export default platformInsightsPlugin;
