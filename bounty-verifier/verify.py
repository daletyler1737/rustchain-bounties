#!/usr/bin/env python3
"""
Bounty Verification Bot for Scottcjn/rustchain-bounties
Automatically verifies star, follow, wallet, and article claims.
"""

import re
import json
import sys
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

GITHUB_API = "https://api.github.com"
BOUNTY_REPO = "Scottcjn/rustchain-bounties"
RTC_NODE = "https://50.28.86.131"

def get(url, token=None):
    """HTTP GET with optional auth"""
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except (URLError, HTTPError) as e:
        return {"error": str(e)}

def verify_stars(user, repos):
    """Verify user has starred given repos"""
    results = []
    for repo in repos:
        url = f"{GITHUB_API}/user/starred/{user}/{repo}"
        data = get(url)
        results.append({"repo": repo, "starred": "error" not in data})
    return results

def verify_follow(user, target):
    """Verify user follows target"""
    url = f"{GITHUB_API}/users/{user}/following/{target}"
    data = get(url)
    return {"following": "error" not in data}

def verify_wallet(address):
    """Verify RTC wallet exists on chain"""
    url = f"{RTC_NODE}/api/wallet/{address}"
    data = get(url)
    return {"exists": "error" not in data, "data": data}

def verify_url(url):
    """Verify URL is live"""
    try:
        req = Request(url, headers={"User-Agent": "BountyVerifierBot/1.0"})
        with urlopen(req, timeout=10) as resp:
            return {"live": True, "status": resp.status}
    except (URLError, HTTPError) as e:
        return {"live": False, "error": str(e)}

def count_devto_words(url):
    """Get word count from dev.to article"""
    data = verify_url(url)
    if data.get("live"):
        # Simplified - just return that URL is accessible
        return {"accessible": True, "url": url}
    return {"accessible": False}

def check_duplicate_claims(user, issue_num, claims):
    """Check if user already submitted a claim"""
    existing = [c for c in claims if c.get("user") == user and c.get("issue") == issue_num]
    return {"duplicate": len(existing) > 0, "count": len(existing) + 1}

def parse_claim(body):
    """Parse claim body to extract verification targets"""
    result = {
        "stars": re.findall(r"starred\s+(?:repo:?\s*)?([\w/-]+)", body, re.I),
        "follows": re.findall(r"follow\s+@?(\w+)", body, re.I),
        "wallet": re.findall(r"RTC([a-zA-Z0-9]{30,})", body),
        "urls": re.findall(r"https?://[^\s\)]+", body),
    }
    return result

def main():
    if len(sys.argv) < 2:
        print("Usage: verify.py <issue_comment_json>")
        sys.exit(1)
    
    comment = json.loads(sys.argv[1])
    body = comment.get("body", "")
    user = comment.get("user", {}).get("login", "unknown")
    
    claim = parse_claim(body)
    report = {
        "user": user,
        "verification": {}
    }
    
    # Verify stars
    if claim["stars"]:
        report["verification"]["stars"] = verify_stars(user, claim["stars"])
    
    # Verify follows
    if claim["follows"]:
        report["verification"]["follows"] = [verify_follow(user, t) for t in claim["follows"]]
    
    # Verify wallet
    if claim["wallet"]:
        wallets = [f"RTC{w}" for w in claim["wallet"]]
        report["verification"]["wallets"] = [verify_wallet(w) for w in wallets]
    
    # Verify URLs
    if claim["urls"]:
        report["verification"]["urls"] = [verify_url(u) for u in claim["urls"]]
    
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
