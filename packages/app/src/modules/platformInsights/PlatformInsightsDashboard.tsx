import { useCallback, useEffect, useState } from 'react';
import {
  discoveryApiRef,
  fetchApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard, Progress } from '@backstage/core-components';
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@material-ui/core';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ErrorIcon from '@material-ui/icons/Error';
import RefreshIcon from '@material-ui/icons/Refresh';

interface ScorecardCheck {
  id: string;
  pillar: string;
  title: string;
  passed: boolean;
  evidence: string;
  remediation: string;
  weight: number;
}

interface PillarSummary {
  pillar: string;
  passed: number;
  total: number;
  percentage: number;
}

interface DoraMetric {
  label: string;
  value: string;
  band: 'Elite' | 'High' | 'Medium' | 'Low';
  detail: string;
}

interface DeliveryEvent {
  sha: string;
  subject: string;
  author: string;
  date: string;
  category: 'feature' | 'fix' | 'revert' | 'chore';
}

interface WorkflowRunSummary {
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

interface PlatformInsightsReport {
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

function getTierColor(tier: string): { bg: string; fg: string } {
  switch (tier) {
    case 'Gold':
      return { bg: '#fef3c7', fg: '#92400e' };
    case 'Silver':
      return { bg: '#e5e7eb', fg: '#1f2937' };
    case 'Bronze':
      return { bg: '#ffedd5', fg: '#9a3412' };
    default:
      return { bg: '#fee2e2', fg: '#991b1b' };
  }
}

function getBandColor(band: DoraMetric['band']): { bg: string; fg: string } {
  switch (band) {
    case 'Elite':
      return { bg: '#dcfce7', fg: '#166534' };
    case 'High':
      return { bg: '#dbeafe', fg: '#1e40af' };
    case 'Medium':
      return { bg: '#fef3c7', fg: '#92400e' };
    default:
      return { bg: '#fee2e2', fg: '#991b1b' };
  }
}

function getConclusionColor(conclusion: string | null): { bg: string; fg: string } {
  if (conclusion === 'success') return { bg: '#dcfce7', fg: '#166534' };
  if (conclusion === 'failure' || conclusion === 'timed_out')
    return { bg: '#fee2e2', fg: '#991b1b' };
  if (conclusion === 'cancelled') return { bg: '#e5e7eb', fg: '#374151' };
  return { bg: '#fef3c7', fg: '#92400e' };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem}s`;
}

function usePlatformInsights() {
  const { entity } = useEntity();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  const [report, setReport] = useState<PlatformInsightsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const repoPath = entity.metadata.annotations?.['idp.dev/local-repo-path'];
  const projectSlug = entity.metadata.annotations?.['github.com/project-slug'];
  const entityName = entity.metadata.name;

  const load = useCallback(async () => {
    if (!repoPath) {
      setLoading(false);
      setError(
        'Add annotation "idp.dev/local-repo-path" to catalog-info.yaml to enable live Scorecard & DORA evaluation.',
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const baseUrl = await discoveryApi.getBaseUrl('platform-insights');
      const params = new URLSearchParams({
        entityName,
        repoPath,
      });
      if (projectSlug) {
        params.set('projectSlug', projectSlug);
      }
      const res = await fetchApi.fetch(`${baseUrl}/evaluate?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: PlatformInsightsReport = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights');
    } finally {
      setLoading(false);
    }
  }, [discoveryApi, fetchApi, entityName, repoPath, projectSlug]);

  useEffect(() => {
    load();
  }, [load]);

  return { report, loading, error, reload: load };
}

/**
 * Compact Overview Card displayed on the Component's Overview tab.
 */
export const PlatformInsightsOverviewCard = () => {
  const { report, loading, error, reload } = usePlatformInsights();

  if (loading) {
    return (
      <InfoCard title="Production Readiness & DORA">
        <Progress />
      </InfoCard>
    );
  }

  if (error || !report) {
    return (
      <InfoCard title="Production Readiness & DORA">
        <Typography variant="body2" color="textSecondary">
          {error || 'No insights available.'}
        </Typography>
      </InfoCard>
    );
  }

  const tierStyle = getTierColor(report.scorecard.tier);
  const doraList = [
    report.dora.deploymentFrequency,
    report.dora.leadTimeForChanges,
    report.dora.changeFailureRate,
    report.dora.meanTimeToRecovery,
  ];

  return (
    <InfoCard
      title="Production Readiness & DORA"
      subheader={
        report.dora.source === 'github-actions'
          ? `Live GitHub Actions (${report.projectSlug})`
          : `Local Git fallback (${report.repoPath})`
      }
      action={
        <Button size="small" startIcon={<RefreshIcon />} onClick={reload}>
          Re-evaluate
        </Button>
      }
    >
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Box>
          <Typography variant="h4" component="span" style={{ fontWeight: 700 }}>
            {report.scorecard.score}%
          </Typography>
          <Typography variant="body2" color="textSecondary" component="span" style={{ marginLeft: 8 }}>
            ({report.scorecard.passedCount}/{report.scorecard.totalCount} checks passing)
          </Typography>
        </Box>
        <Chip
          label={`${report.scorecard.tier} Tier`}
          style={{
            backgroundColor: tierStyle.bg,
            color: tierStyle.fg,
            fontWeight: 700,
          }}
        />
      </Box>

      <LinearProgress
        variant="determinate"
        value={report.scorecard.score}
        style={{ height: 8, borderRadius: 4, marginBottom: 16 }}
      />

      <Grid container spacing={1}>
        {doraList.map(metric => {
          const bandStyle = getBandColor(metric.band);
          return (
            <Grid item xs={6} key={metric.label}>
              <Paper variant="outlined" style={{ padding: 10 }}>
                <Typography variant="caption" color="textSecondary" display="block">
                  {metric.label}
                </Typography>
                <Box display="flex" alignItems="center" justifyContent="space-between" mt={0.5}>
                  <Typography variant="subtitle1" style={{ fontWeight: 700 }}>
                    {metric.value}
                  </Typography>
                  <Chip
                    size="small"
                    label={metric.band}
                    style={{
                      backgroundColor: bandStyle.bg,
                      color: bandStyle.fg,
                      fontWeight: 600,
                      height: 20,
                    }}
                  />
                </Box>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </InfoCard>
  );
};

/**
 * Full Entity Tab ("Scorecards & DORA") with Pillar Breakdown, Remediation Hints,
 * Live GitHub Actions DORA Benchmarks, Pipeline Runs, and Recent Delivery Timeline.
 */
export const PlatformInsightsPage = () => {
  const { report, loading, error, reload } = usePlatformInsights();

  if (loading) {
    return <Progress />;
  }

  if (error || !report) {
    return (
      <InfoCard title="Platform Insights — Scorecards & DORA">
        <Typography variant="body1" color="textSecondary">
          {error || 'No insights available for this entity.'}
        </Typography>
      </InfoCard>
    );
  }

  const tierStyle = getTierColor(report.scorecard.tier);
  const doraList = [
    report.dora.deploymentFrequency,
    report.dora.leadTimeForChanges,
    report.dora.changeFailureRate,
    report.dora.meanTimeToRecovery,
  ];

  return (
    <Grid container spacing={3}>
      {/* Header Summary */}
      <Grid item xs={12}>
        <InfoCard
          title={`Production-Readiness Scorecard — ${report.entityName}`}
          subheader={`Last evaluated: ${new Date(report.evaluatedAt).toLocaleString()} • Repo: ${report.repoPath}`}
          action={
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={reload}
            >
              Run Live Check
            </Button>
          }
        >
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" style={{ gap: 12 }}>
                <Typography variant="h3" style={{ fontWeight: 700 }}>
                  {report.scorecard.score}%
                </Typography>
                <Box>
                  <Chip
                    label={`${report.scorecard.tier} Maturity`}
                    style={{
                      backgroundColor: tierStyle.bg,
                      color: tierStyle.fg,
                      fontWeight: 700,
                      marginBottom: 4,
                    }}
                  />
                  <Typography variant="body2" color="textSecondary">
                    {report.scorecard.passedCount} of {report.scorecard.totalCount} platform checks passed
                  </Typography>
                </Box>
              </Box>
            </Grid>

            <Grid item xs={12} md={8}>
              <Grid container spacing={2}>
                {report.scorecard.pillars.map(p => (
                  <Grid item xs={6} sm={3} key={p.pillar}>
                    <Paper variant="outlined" style={{ padding: 12 }}>
                      <Typography variant="caption" color="textSecondary" display="block">
                        {p.pillar}
                      </Typography>
                      <Typography variant="h6" style={{ fontWeight: 700 }}>
                        {p.passed}/{p.total}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={p.percentage}
                        style={{ height: 6, borderRadius: 3, marginTop: 4 }}
                      />
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </Grid>
          </Grid>
        </InfoCard>
      </Grid>

      {/* DORA Metrics */}
      <Grid item xs={12}>
        <InfoCard
          title="DORA Delivery Metrics"
          subheader={report.dora.sourceNote}
          action={
            <Chip
              size="small"
              label={
                report.dora.source === 'github-actions'
                  ? 'Live GitHub Actions'
                  : 'Git Fallback'
              }
              style={{
                backgroundColor:
                  report.dora.source === 'github-actions' ? '#dcfce7' : '#fef3c7',
                color:
                  report.dora.source === 'github-actions' ? '#166534' : '#92400e',
                fontWeight: 700,
              }}
            />
          }
        >
          <Grid container spacing={2}>
            {doraList.map(metric => {
              const bandStyle = getBandColor(metric.band);
              return (
                <Grid item xs={12} sm={6} md={3} key={metric.label}>
                  <Paper variant="outlined" style={{ padding: 16, height: '100%' }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="subtitle2" color="textSecondary">
                        {metric.label}
                      </Typography>
                      <Chip
                        size="small"
                        label={metric.band}
                        style={{
                          backgroundColor: bandStyle.bg,
                          color: bandStyle.fg,
                          fontWeight: 700,
                        }}
                      />
                    </Box>
                    <Typography variant="h4" style={{ fontWeight: 700, marginBottom: 6 }}>
                      {metric.value}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      {metric.detail}
                    </Typography>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </InfoCard>
      </Grid>

      {/* Live GitHub Actions Pipeline Runs */}
      {report.dora.workflowRuns.length > 0 && (
        <Grid item xs={12}>
          <InfoCard
            title="Live GitHub Actions Pipeline Runs"
            subheader={`Latest CI/CD runs fetched from github.com/${report.projectSlug}`}
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Workflow</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell>Commit</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell align="right">Triggered</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.dora.workflowRuns.map(run => {
                  const statusStyle = getConclusionColor(run.conclusion);
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link href={run.htmlUrl} target="_blank" rel="noopener noreferrer">
                          {run.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={run.isDeployment ? 'Deploy' : 'CI'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={run.conclusion || run.status}
                          style={{
                            backgroundColor: statusStyle.bg,
                            color: statusStyle.fg,
                            fontWeight: 600,
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <code>{run.sha}</code> {run.commitMessage}
                      </TableCell>
                      <TableCell>{formatDuration(run.durationSeconds)}</TableCell>
                      <TableCell align="right">
                        {new Date(run.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </InfoCard>
        </Grid>
      )}

      {/* Detailed Scorecard Checks */}
      <Grid item xs={12}>
        <InfoCard title="Detailed Production-Readiness Checks">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell>Pillar</TableCell>
                <TableCell>Check</TableCell>
                <TableCell>Evidence / Remediation</TableCell>
                <TableCell align="right">Weight</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.scorecard.checks.map(check => (
                <TableRow key={check.id}>
                  <TableCell>
                    {check.passed ? (
                      <CheckCircleIcon style={{ color: '#16a34a' }} />
                    ) : (
                      <ErrorIcon style={{ color: '#dc2626' }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={check.pillar} variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" style={{ fontWeight: 600 }}>
                      {check.title}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{check.evidence}</Typography>
                    {!check.passed && (
                      <Typography variant="caption" style={{ color: '#b91c1c' }}>
                        Fix: {check.remediation}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{check.weight} pts</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </InfoCard>
      </Grid>

      {/* Recent Delivery Timeline */}
      <Grid item xs={12}>
        <InfoCard title="Recent Git Delivery History">
          <Divider />
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Commit</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Author</TableCell>
                <TableCell align="right">Delivered</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.dora.recentDeliveries.map(ev => (
                <TableRow key={ev.sha}>
                  <TableCell>
                    <code>{ev.sha}</code>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={ev.category} variant="outlined" />
                  </TableCell>
                  <TableCell>{ev.subject}</TableCell>
                  <TableCell>{ev.author}</TableCell>
                  <TableCell align="right">
                    {new Date(ev.date).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </InfoCard>
      </Grid>
    </Grid>
  );
};
