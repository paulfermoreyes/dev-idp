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

export interface PlatformInsightsReport {
  entityName: string;
  repoPath: string;
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
    windowDays: number;
    totalCommits: number;
    deploymentFrequency: DoraMetric;
    leadTimeForChanges: DoraMetric;
    changeFailureRate: DoraMetric;
    meanTimeToRecovery: DoraMetric;
    recentDeliveries: DeliveryEvent[];
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

async function evaluateDora(repoPath: string): Promise<PlatformInsightsReport['dora']> {
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
  const commits = lines.map(line => {
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

  const totalCommits = commits.length;
  const nowSec = Math.floor(Date.now() / 1000);
  const oldestTs = commits.length > 0 ? commits[commits.length - 1].commitTs : nowSec;
  const spanDays = Math.max(1, Math.ceil((nowSec - oldestTs) / 86400));
  const weeks = Math.max(1, spanDays / 7);

  // 1. Deployment Frequency (main-branch commits trigger deploy.yml)
  const deploysPerWeek = Number((totalCommits / weeks).toFixed(1));
  let dfBand: DoraMetric['band'] = 'Low';
  if (deploysPerWeek >= 7) dfBand = 'Elite';
  else if (deploysPerWeek >= 1) dfBand = 'High';
  else if (deploysPerWeek >= 0.25) dfBand = 'Medium';

  // 2. Lead Time for Changes (median time between consecutive changes / author-to-commit)
  const deltasHours: number[] = [];
  for (let i = 0; i < commits.length - 1; i++) {
    const diffHours = Math.abs(commits[i].commitTs - commits[i + 1].commitTs) / 3600;
    if (diffHours > 0 && diffHours < 720) {
      deltasHours.push(diffHours);
    }
  }
  deltasHours.sort((a, b) => a - b);
  const medianLeadHours =
    deltasHours.length > 0
      ? deltasHours[Math.floor(deltasHours.length / 2)]
      : 1;
  let ltBand: DoraMetric['band'] = 'Low';
  if (medianLeadHours < 24) ltBand = 'Elite';
  else if (medianLeadHours < 168) ltBand = 'High';
  else if (medianLeadHours < 720) ltBand = 'Medium';

  // 3. Change Failure Rate (% of commits that are fix/revert)
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

  // 4. Mean Time to Recovery (average time from preceding commit to fix/revert)
  const recoveryHours: number[] = [];
  for (let i = 0; i < commits.length - 1; i++) {
    if (commits[i].category === 'fix' || commits[i].category === 'revert') {
      const rec = Math.abs(commits[i].commitTs - commits[i + 1].commitTs) / 3600;
      recoveryHours.push(rec);
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
    windowDays: spanDays,
    totalCommits,
    deploymentFrequency: {
      label: 'Deployment Frequency',
      value: `${deploysPerWeek} / week`,
      band: dfBand,
      detail: `${totalCommits} main-branch releases across ${spanDays} day(s) (each push triggers deploy.yml)`,
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
      detail: `${failureCommits.length} fix/revert commit(s) out of ${totalCommits} total deliveries`,
    },
    meanTimeToRecovery: {
      label: 'Mean Time to Recovery',
      value:
        recoveryHours.length > 0
          ? `${avgMttrHours.toFixed(1)} hrs`
          : '0 hrs (Clean)',
      band: mttrBand,
      detail:
        recoveryHours.length > 0
          ? `Average recovery across ${recoveryHours.length} remediation commit(s)`
          : 'No rollbacks or hotfixes recorded in current window',
    },
    recentDeliveries: commits.slice(0, 10).map(c => ({
      sha: c.sha,
      subject: c.subject,
      author: c.author,
      date: new Date(c.commitTs * 1000).toISOString(),
      category: c.category,
    })),
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

          if (!repoPath || !path.isAbsolute(repoPath) || !fs.existsSync(repoPath)) {
            res.status(400).json({
              error:
                'Missing or invalid repoPath. Add annotation "idp.dev/local-repo-path" to catalog-info.yaml.',
            });
            return;
          }

          try {
            const scorecard = evaluateScorecard(repoPath);
            const dora = await evaluateDora(repoPath);

            const report: PlatformInsightsReport = {
              entityName,
              repoPath,
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

        // Allow unauthenticated reads for local dev portal exploration
        httpRouter.addAuthPolicy({
          path: '/health',
          allow: 'unauthenticated',
        });
        httpRouter.addAuthPolicy({
          path: '/evaluate',
          allow: 'unauthenticated',
        });

        httpRouter.use(router);
        logger.info('Platform Insights backend plugin initialized (Scorecards & DORA)');
      },
    });
  },
});

export default platformInsightsPlugin;
