import dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';

dotenv.config();

const GH_TOKEN = process.env.GH_TOKEN;
const octokit = new Octokit({ auth: GH_TOKEN });
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${GH_TOKEN}`,
  },
});

const PROJECT_NODE_ID = 'PVT_kwDOALOQjs4AA2CL'; // Status Desktop/Mobile Board


function parseGitHubUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!match) throw new Error('Invalid GitHub Epic URL');
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

async function getSubIssues(owner, repo, issueNumber) {
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', {
      owner,
      repo,
      issue_number: issueNumber,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    return res.data || [];
  } catch (err) {
    console.error(`Failed to fetch sub-issues for #${issueNumber}:`, err.message);
    return [];
  }
}

async function getIssueNodeId(owner, repo, number) {
  const { repository } = await graphqlWithAuth(`
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          id
        }
      }
    }
  `, { owner, repo, number });
  return repository.issue.id;
}

async function getProjectStatus(issueId, issueNumber) {
  const query = `
    query($issueId: ID!) {
      node(id: $issueId) {
        ... on Issue {
          projectItems(first: 10) {
            nodes {
              project {
                id
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field {
                      ... on ProjectV2SingleSelectField {
                        name
                      }
                    }
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const { node } = await graphqlWithAuth(query, { issueId });

  const items = node?.projectItems?.nodes || [];
  const project65Item = items.find(item => item?.project?.id === PROJECT_NODE_ID);

  if (!project65Item) {
    console.warn(`⚠️ Issue ${issueNumber} is not in Project 65`);
    return 'unstarted';
  }

  const fieldValues = project65Item.fieldValues.nodes;
  const statusField = fieldValues.find(f => f.field?.name === 'Status');
  return statusField?.name?.toLowerCase().trim() || 'unstarted';
}

function normalizeStatus(status) {
  switch (status) {
    case 'done':
      return 'done';
    case 'code review':
      return 'review';
    case 'in progress':
      return 'progress';
    default:
      return 'unstarted';
  }
}

async function gatherStats(owner, repo, issueNumber, seen = new Set(), isRoot = true) {
  if (seen.has(issueNumber)) return { done: 0, review: 0, progress: 0, unstarted: 0 };
  seen.add(issueNumber);

  let stats = { done: 0, review: 0, progress: 0, unstarted: 0 };

  // Only classify status if it's not the root Epic
  if (!isRoot) {
    const issueId = await getIssueNodeId(owner, repo, issueNumber);
    const rawStatus = await getProjectStatus(issueId, issueNumber);
    const status = normalizeStatus(rawStatus);
    console.log(`Issue #${issueNumber} status: ${status}`);
    stats[status]++;
  }

  const subIssues = await getSubIssues(owner, repo, issueNumber);
  for (const sub of subIssues) {
    const subStats = await gatherStats(owner, repo, sub.number, seen, false);
    for (const key of Object.keys(stats)) {
      stats[key] += subStats[key];
    }
  }

  return stats;
}

function renderEmojiBar(pct) {
  const blocks = 5;
  const score = pct / 100 * blocks;

  const fullGreen = Math.floor(score);
  const hasYellow = score - fullGreen >= 0.5 ? 1 : 0;
  const empty = blocks - fullGreen - hasYellow;

  return '🟩'.repeat(fullGreen) + '🟨'.repeat(hasYellow) + '⬜'.repeat(empty);
}

function showProgress(stats) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const weighted = stats.done + stats.review * 0.5 + stats.progress * 0.25;
  const pct = Math.round((weighted / total) * 100);

  const bar = renderEmojiBar(pct);

  console.log(`----- Epic Progress -----`);
  console.log(`Progress: ${pct}% ${bar}`);
  console.log(`Done: ${stats.done}, Code Review: ${stats.review}, In Progress: ${stats.progress}, Not Started: ${stats.unstarted}`);
}

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node epic-progress.mjs <Epic GitHub Issue URL>');
    process.exit(1);
  }

  const { owner, repo, number } = parseGitHubUrl(url);
  const stats = await gatherStats(owner, repo, number);
  showProgress(stats);
})();
