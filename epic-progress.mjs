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

async function getProjectStatus(issueId, issueNumber, projectNodeId, milestoneTitle = "") {
  const query = `
    query($issueId: ID!) {
      node(id: $issueId) {
        ... on Issue {
          milestone { title }
          projectItems(first: 30) {
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

  if (!node) {
    console.warn(`⚠️ Could not fetch node for issue ${issueNumber}`);
    return null;
  }

  const issueMilestone = node.milestone?.title;
  if (milestoneTitle && issueMilestone !== milestoneTitle) {
    console.log(`⏭️ Skipping issue #${issueNumber} — not in milestone "${milestoneTitle}" (found: "${issueMilestone || 'none'}")`);
    return null;
  }

  const items = node.projectItems?.nodes || [];
  const projectItem = items.find(item => item?.project?.id === projectNodeId);

  if (!projectItem) {
    console.warn(`⚠️ Issue ${issueNumber} is not in project ${projectNodeId}`);
    return 'unstarted';
  }

  const fieldValues = projectItem.fieldValues.nodes;
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

async function gatherStats(owner, repo, issueNumber, projectNodeId, milestoneTitle = "", seen = new Set(), isRoot = true) {
  if (seen.has(issueNumber)) return { done: 0, review: 0, progress: 0, unstarted: 0 };
  seen.add(issueNumber);

  let stats = { done: 0, review: 0, progress: 0, unstarted: 0 };

  // Only classify status if it's not the root Epic
  if (!isRoot) {
    const issueId = await getIssueNodeId(owner, repo, issueNumber);
    const rawStatus = await getProjectStatus(issueId, issueNumber, projectNodeId, milestoneTitle);
    if (!!rawStatus) {
      const status = normalizeStatus(rawStatus);
      console.log(`Issue #${issueNumber} status: ${status}`);
      stats[status]++;
    }
  }

  const subIssues = await getSubIssues(owner, repo, issueNumber);
  for (const sub of subIssues) {
    const subStats = await gatherStats(owner, repo, sub.number, projectNodeId, milestoneTitle, seen, false);
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

async function getProjectNodeIdFromUrl(url, githubToken) {
  const match = url.match(/github\.com\/orgs\/([^/]+)\/projects\/(\d+)/);
  if (!match) throw new Error("Invalid GitHub Project URL format");

  const [, org, number] = match;

  const query = `
    query {
      organization(login: "${org}") {
        projectV2(number: ${number}) {
          id
          title
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${githubToken}`,
    },
    body: JSON.stringify({ query }),
  });

  const data = await response.json();
  return data.data.organization.projectV2.id;
}


(async () => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node epic-progress.mjs [--project-url <Project URL>] --epic-url <Epic URL>');
    process.exit(1);
  }

  const epicUrlArgIndex = args.indexOf('--epic-url');
  if (epicUrlArgIndex === -1 || !args[epicUrlArgIndex + 1]) {
    console.error('Epic URL is required. Use --epic-url <Epic URL> to specify it.');
    process.exit(1);
  }
  const epicUrl = args[epicUrlArgIndex + 1];

  const projectUrlArgIndex = args.indexOf('--project-url');
  if (projectUrlArgIndex === -1 || !args[projectUrlArgIndex + 1]) {
    console.error('Project URL is required. Use --project-url <Project URL> to specify it.');
    process.exit(1);
  }

  let projectNodeId = null;
  const projectUrl = args[projectUrlArgIndex + 1];
  if (!GH_TOKEN) {
    console.error("GH_TOKEN environment variable is required");
    process.exit(1);
  }
  try {
    projectNodeId = await getProjectNodeIdFromUrl(projectUrl, GH_TOKEN);
  } catch (err) {
    console.error("Failed to fetch projectNodeId:", err.message);
    process.exit(1);
  }

  const milestoneArgIndex = args.indexOf('--milestone');
  const milestoneTitle = milestoneArgIndex !== -1 ? args[milestoneArgIndex + 1] : null;

  if (!!milestoneTitle) {
    console.log(`Filtering issues by milestone: "${milestoneTitle}"`);
  }

  const { owner, repo, number } = parseGitHubUrl(epicUrl);
  const stats = await gatherStats(owner, repo, number, projectNodeId, milestoneTitle);
  showProgress(stats);
})();
