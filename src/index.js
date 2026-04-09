// RTC Reward GitHub Action - Pure Node.js implementation
// No external dependencies required

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY;
const GITHUB_EVENT_NAME = process.env.GITHUB_EVENT_NAME;
const GITHUB_EVENT_PATH = process.env.GITHUB_EVENT_PATH;
const GITHUB_API_URL = 'https://api.github.com';

const NODE_URL = process.env.INPUT_NODE-URL || 'https://50.28.86.131';
const AMOUNT = process.env.INPUT_AMOUNT || '5';
const WALLET_FROM = process.env.INPUT_WALLET-FROM || '';
const ADMIN_KEY = process.env.INPUT_ADMIN-KEY || '';
const DRY_RUN = (process.env.INPUT_DRY-RUN || 'false').toLowerCase() === 'true';

function log(msg) {
  console.log(`[rtc-reward] ${msg}`);
}

function setOutput(key, value) {
  console.log(`::set-output name=${key}::${value}`);
}

async function githubApi(endpoint, options = {}) {
  const url = `${GITHUB_API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text}`);
  }
  
  return response.json();
}

function extractWallet(body) {
  if (!body) return null;
  
  const patterns = [
    /(?:wallet|rtc[-_]?wallet)[\s:]+([A-Za-z0-9]+)/i,
    /(?:recipient|to)[\s:]+([A-Za-z0-9]{20,})/i,
  ];
  
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function callRTCRewardApi(walletTo) {
  const url = `${NODE_URL}/api/award`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_KEY}`
    },
    body: JSON.stringify({
      from: WALLET_FROM,
      to: walletTo,
      amount: parseFloat(AMOUNT),
      token: 'RTC'
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RTC API error ${response.status}: ${text}`);
  }
  
  return response.json();
}

async function postComment(issueNumber, body) {
  const [owner, repo] = GITHUB_REPO.split('/');
  await githubApi(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
}

async function run() {
  log(`Event: ${GITHUB_EVENT_NAME}`);
  
  if (GITHUB_EVENT_NAME !== 'pull_request') {
    log('Not a pull_request event, skipping');
    return;
  }
  
  const eventData = JSON.parse(require('fs').readFileSync(GITHUB_EVENT_PATH, 'utf8'));
  const pr = eventData.pull_request;
  
  if (!pr.merged) {
    log('PR not merged, skipping');
    return;
  }
  
  log(`Processing merged PR #${pr.number}: ${pr.title}`);
  
  const [owner, repo] = GITHUB_REPO.split('/');
  
  // Get PR details to find contributor
  const prDetails = await githubApi(`/repos/${owner}/${repo}/pulls/${pr.number}`);
  
  let contributorWallet = extractWallet(pr.body) || extractWallet(prDetails.body);
  let contributor = pr.user?.login;
  
  if (!contributorWallet && contributor) {
    log(`No wallet in PR body, using GitHub username: ${contributor}`);
    contributorWallet = contributor;
  }
  
  if (!contributorWallet) {
    log('No wallet or username found, cannot award');
    setOutput('error', 'No wallet found');
    return;
  }
  
  log(`Contributor wallet: ${contributorWallet}`);
  
  if (DRY_RUN) {
    log(`[DRY RUN] Would award ${AMOUNT} RTC to ${contributorWallet}`);
    setOutput('dry-run', 'true');
    setOutput('wallet', contributorWallet);
    setOutput('amount', AMOUNT);
    return;
  }
  
  try {
    const result = await callRTCRewardApi(contributorWallet);
    const txId = result.txId || result.hash || 'confirmed';
    
    log(`Awarded ${AMOUNT} RTC to ${contributorWallet}, TX: ${txId}`);
    
    await postComment(pr.number, `## 🎉 RTC Reward Sent!\n\n**Amount:** ${AMOUNT} RTC\n**Recipient:** ${contributorWallet}\n**TX:** ${txId}\n\nThank you for your contribution!`);
    
    setOutput('awarded', 'true');
    setOutput('wallet', contributorWallet);
    setOutput('amount', AMOUNT);
    setOutput('tx-id', txId);
  } catch (error) {
    log(`Failed to award RTC: ${error.message}`);
    setOutput('error', error.message);
    
    try {
      await postComment(pr.number, `## ⚠️ RTC Reward Failed\n\n**Recipient:** ${contributorWallet}\n**Error:** ${error.message}\n\nPlease contact a maintainer.`);
    } catch (e) {
      log(`Failed to post comment: ${e.message}`);
    }
  }
}

run().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
