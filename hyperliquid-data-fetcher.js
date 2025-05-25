const axios = require("axios");
const fs = require("fs");
const Groq = require("groq-sdk");
require('dotenv').config({ path: './.env' });

const API_URL = "https://api.hyperliquid.xyz/info";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const HYPERLIQUIDITY_PROVIDER_VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";

const TOP_LEADERBOARD_USERS = [
  "0xbdfa4f4492dd7b7cf211209c4791af8d52bf5c50",
  "0x5078c2fbea2b2ad61bc840bc023e35fce56bedb6",
  "0x656c8da58d738295e03550796dd83900aa7c6525",
  "0xc764acfc6724434fb7a76f1c09db9b42481a443c",
  "0x1ab4973a48dc892cd9971ece8e01dcc7688f8f23",
  "0x7dacca323e44f168494c779bb5e7483c468ef410"
];


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchVaultDetails(address) {
  try {
    console.log(`  Fetching vault details for: ${address}`);
    const response = await axios.post(API_URL, {
      type: "vaultDetails",
      vaultAddress: address
    });
    return response.data;
  } catch (error) {
    console.error(`  ❌ Error fetching vault ${address}:`, error.message);
    return null;
  }
}

async function fetchUserVaultEquities(userAddress) {
  try {
    console.log(`  Fetching vault equities for user: ${userAddress}`);
    const response = await axios.post(API_URL, {
      type: "userVaultEquities",
      user: userAddress
    });
    return response.data;
  } catch (error) {
    console.error(`  ❌ Error fetching vault equities for ${userAddress}:`, error.message);
    return [];
  }
}

async function fetchUserRole(userAddress) {
  try {
    const response = await axios.post(API_URL, {
      type: "userRole",
      user: userAddress
    });
    return response.data;
  } catch (error) {
    console.error(`  ❌ Error fetching user role for ${userAddress}:`, error.message);
    return null;
  }
}

// Get latest portfolio performance (only most recent values)
function getLatestPortfolioMetrics(portfolio) {
  const latestMetrics = {};
  
  portfolio.forEach(([period, stats]) => {
    if (stats.accountValueHistory && stats.accountValueHistory.length > 0) {
      const latest = stats.accountValueHistory[stats.accountValueHistory.length - 1];
      latestMetrics[period] = {
        latestAccountValue: parseFloat(latest[1]),
        timestamp: latest[0]
      };
    }
    
    if (stats.pnlHistory && stats.pnlHistory.length > 0) {
      const latestPnl = stats.pnlHistory[stats.pnlHistory.length - 1];
      if (latestMetrics[period]) {
        latestMetrics[period].latestPnl = parseFloat(latestPnl[1]);
      }
    }
    
    if (latestMetrics[period]) {
      latestMetrics[period].totalVolume = parseFloat(stats.vlm);
    }
  });
  
  return latestMetrics;
}

// Get follower statistics (summary only)
function getFollowerStats(followers) {
  if (!followers || followers.length === 0) {
    return {
      totalFollowers: 0,
      totalEquity: 0,
      averageEquity: 0,
      totalPnl: 0,
      totalAllTimePnl: 0,
      averageDaysFollowing: 0
    };
  }

  const totalEquity = followers.reduce((sum, f) => sum + parseFloat(f.vaultEquity), 0);
  const totalPnl = followers.reduce((sum, f) => sum + parseFloat(f.pnl), 0);
  const totalAllTimePnl = followers.reduce((sum, f) => sum + parseFloat(f.allTimePnl), 0);
  const totalDays = followers.reduce((sum, f) => sum + f.daysFollowing, 0);

  return {
    totalFollowers: followers.length,
    totalEquity: Math.round(totalEquity * 100) / 100,
    averageEquity: Math.round((totalEquity / followers.length) * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalAllTimePnl: Math.round(totalAllTimePnl * 100) / 100,
    averageDaysFollowing: Math.round(totalDays / followers.length),
    // Only include top 3 followers by equity
    topFollowers: followers
      .sort((a, b) => parseFloat(b.vaultEquity) - parseFloat(a.vaultEquity))
      .slice(0, 3)
      .map(f => ({
        user: f.user,
        equity: Math.round(parseFloat(f.vaultEquity) * 100) / 100,
        pnl: Math.round(parseFloat(f.pnl) * 100) / 100,
        daysFollowing: f.daysFollowing
      }))
  };
}

// Format vault data for output (only essential data)
function formatVaultData(data) {
  const followerStats = getFollowerStats(data.followers);
  const latestMetrics = getLatestPortfolioMetrics(data.portfolio);

  return {
    vaultName: data.name || "Unnamed Vault",
    vaultAddress: data.vaultAddress,
    description: data.description ? data.description.substring(0, 200) + (data.description.length > 200 ? "..." : "") : null,
    
    apr: Math.round(data.apr * 10000) / 100, // Convert to percentage with 2 decimals
    maxDistributable: Math.round(parseFloat(data.maxDistributable) * 100) / 100,
    maxWithdrawable: Math.round(parseFloat(data.maxWithdrawable) * 100) / 100,

    isClosed: data.isClosed,
    allowDeposits: data.allowDeposits,
    alwaysCloseOnWithdraw: data.alwaysCloseOnWithdraw || false,
    
    leader: data.leader,
    leaderFraction: Math.round(data.leaderFraction * 10000) / 100, // Convert to percentage
    leaderCommission: data.leaderCommission || 0,
    
    latestPerformance: latestMetrics,
    
    followerStats: followerStats,
    
    hasChildVaults: data.relationship?.type === "parent",
    isChildVault: data.relationship?.type === "child",
    
    lastUpdated: new Date().toISOString()
  };
}

async function analyzeVaultsWithAI(hyperliquidityVault, userVaults, summary, leaderboardData) {
  try {
    console.log("\n🤖 Step 5: Analyzing vault data with AI...");

    const systemPrompt = `You are a DeFi and cryptocurrency vault analysis expert. Analyze the provided Hyperliquid vault data and provide comprehensive insights.

Your analysis should be structured and include:

1. EXECUTIVE SUMMARY (2-3 sentences overview)
2. HYPERLIQUIDITY PROVIDER VAULT ANALYSIS
3. USER-OWNED VAULTS ANALYSIS 
4. COMPARATIVE ANALYSIS
5. RISK ASSESSMENT
6. INVESTMENT OPPORTUNITIES
7. STRATEGIC RECOMMENDATIONS
8. MARKET INSIGHTS

For each section, provide:
- Key metrics and statistics
- Performance trends
- Risk factors
- Opportunities
- Actionable insights

Focus on:
- APR performance and sustainability
- Follower growth and retention
- Capital efficiency
- Risk-adjusted returns
- Market positioning
- Growth potential
- Competitive advantages

Be specific with numbers and provide clear, actionable recommendations for both vault followers and vault operators.`;

    const analysisData = {
      hyperliquidityProviderVault: hyperliquidityVault,
      userOwnedVaults: Object.fromEntries(
        Object.entries(userVaults).slice(0, 10) // Limit to top 10 to avoid token limits
      ),
      summaryMetrics: summary,
      leaderboardUserData: {
        totalUsers: Object.keys(leaderboardData).length,
        vaultLeaders: Object.values(leaderboardData).filter(u => u.isVaultLeader).length,
        usersWithDeposits: Object.values(leaderboardData).filter(u => u.totalVaultDeposits > 0).length
      },
      marketContext: {
        analysisDate: new Date().toISOString(),
        totalVaultsAnalyzed: Object.keys(userVaults).length + 1,
        dataSource: "Hyperliquid API"
      }
    };

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Please analyze this Hyperliquid vault ecosystem data and provide comprehensive insights:

${JSON.stringify(analysisData, null, 2)}`
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_tokens: 4096
    });

    return completion.choices[0]?.message?.content || "Analysis could not be completed.";

  } catch (error) {
    console.error("❌ Error during AI analysis:", error.message);
    return `AI Analysis Error: ${error.message}. Please check your Groq API key and connection.`;
  }
}

// Generate comprehensive structured insights with detailed comparisons
async function generateDetailedInsights(hyperliquidityVault, userVaults, summary) {
  try {
    console.log("  🧠 Generating detailed investment insights...");

    const allVaults = {
      "Hyperliquidity Provider": hyperliquidityVault,
      ...userVaults
    };

    const vaultComparison = Object.entries(allVaults).map(([name, vault]) => ({
      name: vault.vaultName || name,
      address: vault.vaultAddress,
      apr: vault.apr,
      followers: vault.followerStats.totalFollowers,
      totalEquity: vault.followerStats.totalEquity,
      averageEquity: vault.followerStats.averageEquity,
      leaderFraction: vault.leaderFraction,
      leaderCommission: vault.leaderCommission,
      allowDeposits: vault.allowDeposits,
      isClosed: vault.isClosed,
      riskScore: calculateRiskScore(vault)
    }));

    const insightPrompt = `You are a quantitative DeFi analyst. Based on the vault comparison data provided, generate a comprehensive analysis report in markdown format.

The report should include:

1. **INVESTMENT RECOMMENDATIONS** - Specific vault recommendations for different investor profiles
2. **VAULT COMPARISON TABLE** - A detailed markdown table comparing all vaults
3. **RISK ANALYSIS** - Risk assessment for each vault category
4. **ENTRY STRATEGIES** - Specific entry points and allocation recommendations
5. **PERFORMANCE INSIGHTS** - Key performance metrics and trends

For the comparison table, include these columns:
- Vault Name
- APR (%)
- Followers
- Total Equity ($)
- Risk Level
- Recommendation

Format as proper markdown with tables, headers, and bullet points.
Provide specific numbers, percentages, and dollar amounts.
Give clear investment recommendations for Conservative, Moderate, and Aggressive investors.`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a quantitative DeFi analyst specializing in vault performance analysis. Provide detailed, structured insights in markdown format with specific recommendations."
        },
        {
          role: "user",
          content: `${insightPrompt}\n\nVault Comparison Data:\n${JSON.stringify(vaultComparison, null, 2)}\n\nSummary Metrics:\n${JSON.stringify(summary, null, 2)}`
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.15,
      max_tokens: 4000
    });

    return completion.choices[0]?.message?.content || "Detailed insights could not be generated.";

  } catch (error) {
    console.error("❌ Error generating detailed insights:", error.message);
    return `Error generating insights: ${error.message}`;
  }
}

// Calculate risk score for a vault (0-100, higher = riskier)
function calculateRiskScore(vault) {
  let riskScore = 0;
  
  // APR risk (higher APR = higher risk)
  if (vault.apr > 100) riskScore += 40;
  else if (vault.apr > 50) riskScore += 25;
  else if (vault.apr > 20) riskScore += 10;
  
  // Leader concentration risk
  if (vault.leaderFraction > 50) riskScore += 30;
  else if (vault.leaderFraction > 20) riskScore += 15;
  else if (vault.leaderFraction > 5) riskScore += 5;
  
  // Follower concentration risk
  if (vault.followerStats.totalFollowers < 10) riskScore += 20;
  else if (vault.followerStats.totalFollowers < 50) riskScore += 10;
  
  // Vault status risk
  if (vault.isClosed) riskScore += 25;
  if (!vault.allowDeposits) riskScore += 15;
  
  return Math.min(riskScore, 100);
}

async function generateStructuredInsights(data) {
  try {
    console.log("  📊 Generating structured insights...");

    const insightPrompt = `Analyze the vault data and provide structured insights in JSON format. 

Return ONLY valid JSON with this exact structure:
{
  "topPerformers": {
    "byAPR": ["vault1 analysis", "vault2 analysis"],
    "byEquity": ["vault1 analysis", "vault2 analysis"], 
    "byFollowers": ["vault1 analysis", "vault2 analysis"]
  },
  "riskAssessment": {
    "lowRisk": ["analysis of safest vaults"],
    "mediumRisk": ["analysis of moderate risk vaults"],
    "highRisk": ["analysis of highest risk vaults"]
  },
  "recommendations": {
    "conservative": ["specific recommendations for risk-averse investors"],
    "moderate": ["specific recommendations for balanced investors"],
    "aggressive": ["specific recommendations for high-risk investors"]
  },
  "marketInsights": ["key market observations and trends"]
}

Be specific with vault names, numbers, and percentages.`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a DeFi analyst. Return only valid JSON with the specified structure."
        },
        {
          role: "user",
          content: `${insightPrompt}\n\nData:\n${JSON.stringify(data, null, 2)}`
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      max_tokens: 2000
    });

    const response = completion.choices[0]?.message?.content || "{}";
    
    try {
      return JSON.parse(response);
    } catch {
      const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      return { error: "Could not parse structured insights", rawResponse: response };
    }

  } catch (error) {
    console.error("❌ Error generating structured insights:", error.message);
    return { error: error.message };
  }
}

async function main() {
  try {
    // console.log(process.env);
    if (!process.env.GROQ_API_KEY) {
      console.error("❌ GROQ_API_KEY not found in environment variables!");
      console.log("💡 Create a .env file with: GROQ_API_KEY=your-api-key-here");
      console.log("💡 Or set it with: export GROQ_API_KEY='your-api-key-here'");
      process.exit(1);
    }

    console.log("🚀 Starting Hyperliquid Vault Data Fetcher with AI Analysis...\n");

    // Step 1: Fetch Hyperliquidity Provider Vault
    console.log("📊 Step 1: Fetching Hyperliquidity Provider Vault...");
    const hyperliquidityVaultData = await fetchVaultDetails(HYPERLIQUIDITY_PROVIDER_VAULT);
    
    if (!hyperliquidityVaultData) {
      console.error("❌ Failed to fetch Hyperliquidity Provider Vault");
      return;
    }

    const formattedHyperliquidityVault = formatVaultData(hyperliquidityVaultData);
    
    console.log(`✅ Hyperliquidity Provider Vault fetched: ${formattedHyperliquidityVault.vaultName}`);
    console.log(`   - APR: ${formattedHyperliquidityVault.apr}%`);
    console.log(`   - Total Followers: ${formattedHyperliquidityVault.followerStats.totalFollowers}`);
    console.log(`   - Total Equity: $${formattedHyperliquidityVault.followerStats.totalEquity.toLocaleString()}`);
    
    await delay(100); // Rate limiting

    // Step 2: Find all user-owned vaults from leaderboard users
    console.log("\n📊 Step 2: Discovering user-owned vaults from top leaderboard users...");
    
    const allUserVaultAddresses = new Set();
    const userVaultData = {};

    for (let i = 0; i < TOP_LEADERBOARD_USERS.length; i++) {
      const userAddress = TOP_LEADERBOARD_USERS[i];
      console.log(`\n[${i + 1}/${TOP_LEADERBOARD_USERS.length}] Processing user: ${userAddress}`);

      // Check if user is a vault leader
      const userRole = await fetchUserRole(userAddress);
      await delay(50); // Rate limiting

      if (userRole && userRole.role === "vault") {
        console.log(`  🏦 User is a vault leader`);
        allUserVaultAddresses.add(userAddress);
      }

      // Get user's vault deposits/equities
      const vaultEquities = await fetchUserVaultEquities(userAddress);
      await delay(50); // Rate limiting

      if (vaultEquities && vaultEquities.length > 0) {
        console.log(`  💰 User has ${vaultEquities.length} vault deposit(s)`);
        vaultEquities.forEach(equity => {
          if (equity.vaultAddress !== HYPERLIQUIDITY_PROVIDER_VAULT) {
            allUserVaultAddresses.add(equity.vaultAddress);
            console.log(`    - Vault: ${equity.vaultAddress} (Equity: $${parseFloat(equity.equity).toLocaleString()})`);
          }
        });
      }

      // Store only essential user data
      userVaultData[userAddress] = {
        role: userRole?.role || "user",
        isVaultLeader: userRole?.role === "vault",
        totalVaultDeposits: vaultEquities?.length || 0,
        vaultEquities: (vaultEquities || []).map(eq => ({
          vaultAddress: eq.vaultAddress,
          equity: Math.round(parseFloat(eq.equity) * 100) / 100
        }))
      };
    }

    console.log(`\n✅ Discovered ${allUserVaultAddresses.size} unique user-owned vaults`);

    // Step 3: Fetch details for all user-owned vaults
    console.log("\n📊 Step 3: Fetching details for all user-owned vaults...");
    
    const userOwnedVaults = {};
    const vaultAddresses = Array.from(allUserVaultAddresses);

    for (let i = 0; i < vaultAddresses.length; i++) {
      const vaultAddress = vaultAddresses[i];
      console.log(`\n[${i + 1}/${vaultAddresses.length}] Fetching vault: ${vaultAddress}`);

      const vaultData = await fetchVaultDetails(vaultAddress);
      await delay(100); // Rate limiting between vault fetches

      if (vaultData) {
        const formattedVault = formatVaultData(vaultData);
        userOwnedVaults[vaultAddress] = formattedVault;
        
        console.log(`  ✅ ${formattedVault.vaultName}`);
        console.log(`     - Leader: ${formattedVault.leader}`);
        console.log(`     - APR: ${formattedVault.apr}%`);
        console.log(`     - Followers: ${formattedVault.followerStats.totalFollowers}`);
        console.log(`     - Total Equity: $${formattedVault.followerStats.totalEquity.toLocaleString()}`);
      }
    }

    // Step 4: Create summary report
    const summary = {
      executionTime: new Date().toISOString(),
      
      hyperliquidityProviderVault: {
        address: HYPERLIQUIDITY_PROVIDER_VAULT,
        name: formattedHyperliquidityVault.vaultName,
        apr: formattedHyperliquidityVault.apr,
        totalFollowers: formattedHyperliquidityVault.followerStats.totalFollowers,
        totalEquity: formattedHyperliquidityVault.followerStats.totalEquity,
        averageEquityPerFollower: formattedHyperliquidityVault.followerStats.averageEquity,
        maxWithdrawable: formattedHyperliquidityVault.maxWithdrawable
      },
      
      userOwnedVaults: {
        totalCount: Object.keys(userOwnedVaults).length,
        totalFollowersAcrossAllVaults: Object.values(userOwnedVaults)
          .reduce((sum, vault) => sum + vault.followerStats.totalFollowers, 0),
        totalEquityAcrossAllVaults: Math.round(Object.values(userOwnedVaults)
          .reduce((sum, vault) => sum + vault.followerStats.totalEquity, 0) * 100) / 100,
        averageAPR: Object.keys(userOwnedVaults).length > 0 ? Math.round(Object.values(userOwnedVaults)
          .reduce((sum, vault) => sum + vault.apr, 0) / Object.keys(userOwnedVaults).length * 100) / 100 : 0,
        
        topVaultsByFollowers: Object.entries(userOwnedVaults)
          .sort(([,a], [,b]) => b.followerStats.totalFollowers - a.followerStats.totalFollowers)
          .slice(0, 5)
          .map(([address, vault]) => ({
            address,
            name: vault.vaultName,
            followers: vault.followerStats.totalFollowers,
            equity: vault.followerStats.totalEquity,
            apr: vault.apr
          })),
          
        topVaultsByAPR: Object.entries(userOwnedVaults)
          .sort(([,a], [,b]) => b.apr - a.apr)
          .slice(0, 5)
          .map(([address, vault]) => ({
            address,
            name: vault.vaultName,
            apr: vault.apr,
            followers: vault.followerStats.totalFollowers,
            equity: vault.followerStats.totalEquity
          }))
      },
      
      leaderboardUsers: {
        totalProcessed: TOP_LEADERBOARD_USERS.length,
        vaultLeaders: Object.values(userVaultData).filter(user => user.isVaultLeader).length,
        usersWithVaultDeposits: Object.values(userVaultData).filter(user => user.totalVaultDeposits > 0).length,
        totalVaultDepositsFromLeaderboard: Object.values(userVaultData)
          .reduce((sum, user) => sum + user.totalVaultDeposits, 0)
      }
    };

    // Step 5: AI Analysis
    const comprehensiveAnalysis = await analyzeVaultsWithAI(
      formattedHyperliquidityVault, 
      userOwnedVaults, 
      summary, 
      userVaultData
    );

    // Generate detailed insights with comparison tables
    const detailedInsights = await generateDetailedInsights(
      formattedHyperliquidityVault,
      userOwnedVaults,
      summary
    );

    // Generate structured insights
    const structuredInsights = await generateStructuredInsights({
      hyperliquidityVault: formattedHyperliquidityVault,
      userVaults: userOwnedVaults,
      summary
    });

    // Step 6: Save all data
    console.log("\n💾 Step 6: Saving data and analysis to files...");

    // Save original data files
    fs.writeFileSync(
      "hyperliquidity-provider-vault.json", 
      JSON.stringify(formattedHyperliquidityVault, null, 2)
    );

    fs.writeFileSync(
      "user-owned-vaults.json", 
      JSON.stringify(userOwnedVaults, null, 2)
    );

    fs.writeFileSync(
      "leaderboard-users-data.json", 
      JSON.stringify(userVaultData, null, 2)
    );

    fs.writeFileSync(
      "vault-summary-report.json", 
      JSON.stringify(summary, null, 2)
    );

    // Save AI analysis
    const aiAnalysisReport = {
      metadata: {
        analysisDate: new Date().toISOString(),
        dataSource: "Hyperliquid API",
        aiModel: "llama-3.3-70b-versatile",
        vaultsAnalyzed: Object.keys(userOwnedVaults).length + 1
      },
      comprehensiveAnalysis,
      detailedInsights,
      structuredInsights,
      dataDigest: {
        totalEcosystemValue: summary.hyperliquidityProviderVault.totalEquity + summary.userOwnedVaults.totalEquityAcrossAllVaults,
        averageEcosystemAPR: (summary.hyperliquidityProviderVault.apr + summary.userOwnedVaults.averageAPR) / 2,
        totalFollowers: summary.hyperliquidityProviderVault.totalFollowers + summary.userOwnedVaults.totalFollowersAcrossAllVaults,
        vaultLeadershipRate: (summary.leaderboardUsers.vaultLeaders / summary.leaderboardUsers.totalProcessed * 100).toFixed(2) + "%"
      }
    };

    fs.writeFileSync(
      "ai-vault-analysis.json", 
      JSON.stringify(aiAnalysisReport, null, 2)
    );

    // Generate enhanced markdown report
    const markdownReport = `# Hyperliquid Vault Ecosystem Analysis

*Generated on ${new Date().toISOString()}*

## Executive Summary

**Total Ecosystem Value:** $${(summary.hyperliquidityProviderVault.totalEquity + summary.userOwnedVaults.totalEquityAcrossAllVaults).toLocaleString()}

**Key Metrics:**
- Hyperliquidity Provider Vault: ${summary.hyperliquidityProviderVault.apr}% APR, ${summary.hyperliquidityProviderVault.totalFollowers.toLocaleString()} followers
- User-owned Vaults: ${Object.keys(userOwnedVaults).length} vaults, ${summary.userOwnedVaults.averageAPR}% avg APR
- Vault Leaders from Top Traders: ${summary.leaderboardUsers.vaultLeaders}/${summary.leaderboardUsers.totalProcessed}

---

## AI Analysis

${comprehensiveAnalysis}

---

## Detailed Investment Analysis

${detailedInsights}

---

## Structured Insights

${JSON.stringify(structuredInsights, null, 2)}

---

*Analysis powered by Groq AI and Hyperliquid API data*
`;

    fs.writeFileSync("vault-analysis-report.md", markdownReport);

    console.log("✅ All data and analysis saved successfully!");

    // Final summary
    console.log("\n🎉 Complete analysis finished!");
    console.log("\n📊 ECOSYSTEM OVERVIEW:");
    console.log(`  • Total Ecosystem Value: $${(summary.hyperliquidityProviderVault.totalEquity + summary.userOwnedVaults.totalEquityAcrossAllVaults).toLocaleString()}`);
    console.log(`  • Hyperliquidity Provider: ${summary.hyperliquidityProviderVault.apr}% APR, ${summary.hyperliquidityProviderVault.totalFollowers.toLocaleString()} followers`);
    console.log(`  • User Vaults: ${Object.keys(userOwnedVaults).length} vaults, avg ${summary.userOwnedVaults.averageAPR}% APR`);
    console.log(`  • Vault Leaders: ${summary.leaderboardUsers.vaultLeaders}/${summary.leaderboardUsers.totalProcessed} top traders`);

    console.log("\n📁 FILES CREATED:");
    console.log("  • hyperliquidity-provider-vault.json - Main vault data");
    console.log("  • user-owned-vaults.json - User vault data");
    console.log("  • leaderboard-users-data.json - User analysis");
    console.log("  • vault-summary-report.json - Summary metrics");
    console.log("  • ai-vault-analysis.json - Complete AI analysis");
    console.log("  • vault-analysis-report.md - Human-readable report");

  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    console.error(error.stack);
  }
}

main();