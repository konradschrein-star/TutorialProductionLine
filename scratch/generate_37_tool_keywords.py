import pandas as pd
import re
import os
import glob
import json

# 1. Load the 37 tools from Excel
excel_path = r'C:\Users\konra\Downloads\Verified 37 Global Tutorial Gaps (1).xlsx'
tools_df = pd.read_excel(excel_path)

tools_map = {}
for idx, r in tools_df.iterrows():
    num = int(r['#'])
    raw_name = str(r['Tool / Brand']).strip()
    cat = str(r['Category']).strip()
    ideas = str(r['5 Content Ideas']).strip()
    
    # Extract clean canonical software name
    clean_name = raw_name
    if "Dext" in raw_name:
        clean_name = "Dext"
    elif "Make" in raw_name:
        clean_name = "Make"
    elif "Brevo" in raw_name:
        clean_name = "Brevo"
    elif "Remote.com" in raw_name:
        clean_name = "Remote.com"
    elif "Monday.com" in raw_name:
        clean_name = "Monday.com"
    elif "QuickBooks Online" in raw_name:
        clean_name = "QuickBooks"
    elif "(" in raw_name:
        clean_name = raw_name.split("(")[0].strip()

    tools_map[num] = {
        'num': num,
        'raw_name': raw_name,
        'name': clean_name,
        'category': cat,
        'ideas': [i.strip() for i in re.split(r'[·•,]', ideas) if i.strip()]
    }

print(f"Loaded {len(tools_map)} tools.")

# Aliases for matching existing files
aliases_to_tool = {}
for num, t in tools_map.items():
    name = t['name']
    aliases = [name.lower()]
    if t['name'] == 'Make':
        aliases.extend(['integromat', 'make.com', 'make'])
    elif t['name'] == 'Dext':
        aliases.extend(['receipt bank', 'receiptbank', 'dext'])
    elif t['name'] == 'Brevo':
        aliases.extend(['sendinblue', 'brevo'])
    elif t['name'] == 'Looker Studio':
        aliases.extend(['looker', 'google data studio', 'looker studio'])
    elif t['name'] == 'QuickBooks':
        aliases.extend(['quickbooks', 'quickbooks online', 'qbo'])
    elif t['name'] == 'TradingView':
        aliases.extend(['tradingview', 'trading view'])
    elif t['name'] == 'Monday.com':
        aliases.extend(['monday.com', 'monday'])
    elif t['name'] == 'Remote.com':
        aliases.extend(['remote.com', 'remote'])
    elif t['name'] == 'Webex':
        aliases.extend(['cisco webex', 'webex'])
    
    for a in aliases:
        aliases_to_tool[a.lower()] = t['name']

# High quality curated core tutorials for each of the 37 software tools (following Prompt.txt)
# E.g. clear, reproducible outcome, no coding/API required, step-by-step visual UI workflow
curated_keywords_by_tool = {
    "Xero": [
        "How to Set Up a New Company in Xero",
        "How to Reconcile Bank Transactions in Xero",
        "How to Create and Send Invoices in Xero",
        "How to Set Up Payroll in Xero",
        "How to Add and Manage Bank Accounts in Xero",
        "How to Run a Profit and Loss Report in Xero",
        "How to Track Expenses and Bills in Xero",
        "How to Set Up VAT and Sales Tax in Xero",
        "How to Import Bank Statements into Xero",
        "How to Connect Stripe or PayPal to Xero",
        "How to Create Recurring Invoices in Xero",
        "How to Set Up Chart of Accounts in Xero",
        "How to Add Multiple Users and Permissions in Xero",
        "How to Run Balance Sheet Reports in Xero",
        "How to Reconcile Credit Card Accounts in Xero",
    ],
    "Dext": [
        "How to Scan and Upload Receipts in Dext Prepare",
        "How to Connect Dext to Xero",
        "How to Connect Dext to QuickBooks Online",
        "How to Set Up Auto-Categorization Rules in Dext",
        "How to Manage Supplier Rules in Dext",
        "How to Extract Line Items from Invoices in Dext",
        "How to Submit Mileage and Expense Reports in Dext",
        "How to Forward Email Invoices into Dext",
        "How to Export Receipt Data from Dext",
        "How to Set Up Approval Workflows in Dext",
        "How to Add Team Members and Clients in Dext",
        "How to Fix Duplicate Transactions in Dext",
    ],
    "Pipedrive": [
        "How to Set Up a Sales Pipeline in Pipedrive",
        "How to Sync Gmail and Outlook with Pipedrive",
        "How to Create and Track Deals in Pipedrive",
        "How to Set Up Workflow Automations in Pipedrive",
        "How to Import Contacts and Leads from CSV into Pipedrive",
        "How to Build Custom Sales Reports in Pipedrive",
        "How to Customize Deal Stages and Probabilities in Pipedrive",
        "How to Schedule Activities and Follow-Ups in Pipedrive",
        "How to Use the Pipedrive LeadBooster Chatbot",
        "How to Connect Pipedrive to Zapier and Slack",
        "How to Set Sales Goals and Targets in Pipedrive",
        "How to Create Email Templates in Pipedrive",
    ],
    "Deel": [
        "How to Set Up and Onboard Contractors in Deel",
        "How to Run Global Payroll in Deel",
        "How to Create Compliant Contractor Agreements in Deel",
        "How to Fund and Pay Global Teams in Deel",
        "How to Request and Approve Time Off in Deel",
        "How to Generate Tax and Invoicing Documents in Deel",
        "How to Hire Full-Time Employees via Deel EOR",
        "How to Integrate Deel with QuickBooks and Xero",
        "How to Set Up Expense Reimbursements in Deel",
        "How to Add Background Checks in Deel",
        "How to Manage Multi-Currency Balances in Deel",
    ],
    "Remote.com": [
        "How to Hire International Employees on Remote.com",
        "How to Onboard Global Contractors on Remote.com",
        "How to Set Up International Payroll on Remote.com",
        "How to Create Compliant Employment Contracts on Remote.com",
        "How to Manage Employee Benefits and IP on Remote.com",
        "How to Review and Approve Invoices on Remote.com",
        "How to Integrate Remote.com with HR and Accounting Tools",
        "How to Track Time and Expenses on Remote.com",
        "How to Pay Global Contractors in Local Currencies on Remote.com",
        "How to Generate Global Tax Documents on Remote.com",
    ],
    "Rippling": [
        "How to Onboard a New Employee in Rippling",
        "How to Run Payroll in Rippling",
        "How to Provision Laptops and Software Licenses in Rippling",
        "How to Set Up Employee Benefits in Rippling",
        "How to Track Time and Attendance in Rippling",
        "How to Manage Device Security and Passwords in Rippling",
        "How to Build Custom HR Reports and Dashboards in Rippling",
        "How to Set Up Automated Workflows in Rippling",
        "How to Manage Offboarding and App Deprovisioning in Rippling",
        "How to Configure PTO and Leave Policies in Rippling",
    ],
    "TradingView": [
        "How to Set Up and Customize Charts in TradingView",
        "How to Use the Stock and Crypto Screener in TradingView",
        "How to Set Up Price and Indicator Alerts in TradingView",
        "How to Add and Customize Indicators in TradingView",
        "How to Create and Save Chart Layouts in TradingView",
        "How to Draw Trendlines and Fibonacci Retracements in TradingView",
        "How to Use Pine Script to Add Custom Indicators in TradingView",
        "How to Use the Bar Replay Tool for Backtesting in TradingView",
        "How to Connect a Broker Account to TradingView",
        "How to Build Watchlists and Section Tags in TradingView",
        "How to Use Volume Profile on TradingView",
    ],
    "Notion": [
        "How to Build a Project Management Dashboard in Notion",
        "How to Use Notion Databases and Relations",
        "How to Create Custom Templates in Notion",
        "How to Use Notion AI to Generate Summaries and Tasks",
        "How to Build a Team Wiki and Knowledge Base in Notion",
        "How to Connect Notion to Google Calendar and Slack",
        "How to Use Notion Formulas 2.0",
        "How to Create a Content Calendar in Notion",
        "How to Share Notion Pages and Manage Permissions",
        "How to Build a CRM in Notion from Scratch",
        "How to Use Notion Web Clipper to Save Articles",
        "How to Export Notion Pages as PDF and Markdown",
    ],
    "ClickUp": [
        "How to Set Up a Workspace Hierarchy in ClickUp",
        "How to Create Custom Automations in ClickUp",
        "How to Build Dashboards and Reporting in ClickUp",
        "How to Use ClickUp Views: List, Board, Gantt, and Calendar",
        "How to Track Time and Billable Hours in ClickUp",
        "How to Set Up Sprints and Agile Backlogs in ClickUp",
        "How to Create Custom Fields and Statuses in ClickUp",
        "How to Use ClickUp Docs and AI Writer",
        "How to Integrate ClickUp with Google Drive and Slack",
        "How to Set Up Client Portals and Permissions in ClickUp",
        "How to Import Tasks from Trello and Asana into ClickUp",
    ],
    "Monday.com": [
        "How to Build a Project Tracking Board in Monday.com",
        "How to Set Up Automations in Monday.com",
        "How to Create Multi-Board Dashboards in Monday.com",
        "How to Use Monday.com as a Sales CRM",
        "How to Manage Team Workload and Resource Allocation in Monday.com",
        "How to Integrate Monday.com with Slack and Google Calendar",
        "How to Use Monday.com Forms to Collect Requests",
        "How to Set Up Timeline and Gantt Views in Monday.com",
        "How to Customize Column Types and Statuses in Monday.com",
        "How to Use Monday AI to Summarize Updates",
        "How to Export Monday.com Board Data to Excel",
    ],
    "Zapier": [
        "How to Create a Multi-Step Zap in Zapier",
        "How to Connect Webhooks to Zapier",
        "How to Use Formatter by Zapier to Clean and Split Text",
        "How to Use Zapier Paths for Conditional Logic",
        "How to Connect Google Sheets to Gmail in Zapier",
        "How to Automate Lead Capture from Facebook Ads with Zapier",
        "How to Use Zapier Tables to Store and Filter Data",
        "How to Connect OpenAI and ChatGPT to Zapier Automations",
        "How to Schedule Automated Daily or Weekly Tasks in Zapier",
        "How to Troubleshoot and Test Zapier Errors",
        "How to Transfer Existing Data with Zapier Transfer",
    ],
    "Make": [
        "How to Build Your First Scenario in Make.com",
        "How to Use Webhooks in Make.com",
        "How to Use Routers and Filters in Make.com",
        "How to Connect Google Sheets and Airtable in Make.com",
        "How to Use the HTTP Module to Call External APIs in Make.com",
        "How to Handle Errors with Directives in Make.com",
        "How to Parse JSON and Array Data in Make.com",
        "How to Automate Email Sending with Make.com and Gmail",
        "How to Integrate OpenAI ChatGPT in Make.com Scenarios",
        "How to Schedule and Run Scenarios Automatically in Make.com",
        "How to Use Data Stores to Cache Data in Make.com",
    ],
    "HubSpot": [
        "How to Set Up Free HubSpot CRM from Scratch",
        "How to Create and Send Marketing Emails in HubSpot",
        "How to Build High-Converting Landing Pages in HubSpot",
        "How to Set Up Lead Capture Forms and Popups in HubSpot",
        "How to Create and Manage Sales Pipelines in HubSpot",
        "How to Build Automated Email Workflows in HubSpot",
        "How to Connect Gmail and Outlook to HubSpot",
        "How to Segment Contacts Using Lists in HubSpot",
        "How to Track Website Visitors and Analytics in HubSpot",
        "How to Use HubSpot AI to Write Email Content",
        "How to Create Meeting Booking Links in HubSpot",
    ],
    "Airtable": [
        "How to Build a Relational Database in Airtable",
        "How to Create Custom Automations in Airtable",
        "How to Build Interfaces and Client Portals in Airtable",
        "How to Use Linked Records and Lookup Fields in Airtable",
        "How to Build a Content Production Pipeline in Airtable",
        "How to Use Airtable Forms to Collect Data",
        "How to Integrate Airtable with Make.com and Zapier",
        "How to Use Airtable AI to Summarize and Categorize Records",
        "How to Sync Google Calendar with Airtable",
        "How to Build Kanban and Timeline Views in Airtable",
        "How to Set User Permissions and View-Level Sharing in Airtable",
    ],
    "Webflow": [
        "How to Build a Responsive Landing Page in Webflow",
        "How to Set Up CMS Collections and Dynamic Lists in Webflow",
        "How to Create Custom Interactions and Hover Animations in Webflow",
        "How to Connect a Custom Domain in Webflow",
        "How to Set Up SEO Meta Tags and OpenGraph Images in Webflow",
        "How to Build an E-Commerce Product Page in Webflow",
        "How to Use Webflow Components and Symbols",
        "How to Embed Custom Code and HTML in Webflow",
        "How to Set Up Form Submissions and Redirects in Webflow",
        "How to Use Webflow Localization for Multi-Language Sites",
    ],
    "Framer": [
        "How to Build and Publish a Website in Framer",
        "How to Use Framer AI to Generate a Complete Website",
        "How to Set Up CMS Collections and Blog Pages in Framer",
        "How to Create Scroll Effects and Parallax Animations in Framer",
        "How to Connect a Custom Domain in Framer",
        "How to Create Interactive Components with Variants in Framer",
        "How to Build Responsive Layouts for Mobile and Tablet in Framer",
        "How to Add Navigation Bars and Sticky Headers in Framer",
        "How to Optimize Framer SEO and Page Speed",
        "How to Add Forms and Connect to Mailchimp in Framer",
    ],
    "Canva": [
        "How to Set Up Brand Kits and Colors in Canva",
        "How to Use Canva Magic Studio and AI Features",
        "How to Create Professional Presentations in Canva",
        "How to Design YouTube Thumbnails in Canva",
        "How to Use Bulk Create to Generate 50+ Graphics in Canva",
        "How to Remove Backgrounds from Images and Videos in Canva",
        "How to Animate Elements and Text in Canva",
        "How to Collaborate and Share Templates with Teams in Canva",
        "How to Schedule Social Media Posts Directly from Canva",
        "How to Resize Designs for Multiple Social Platforms in Canva",
    ],
    "Figma": [
        "How to Use Auto Layout in Figma",
        "How to Create Reusable Components and Variants in Figma",
        "How to Set Up Design System Variables and Color Tokens in Figma",
        "How to Build Interactive Prototypes with Smart Animate in Figma",
        "How to Use Figma Dev Mode to Inspect CSS and Code",
        "How to Create Responsive Wireframes in Figma",
        "How to Use Figma Plugins to Speed Up UI Design",
        "How to Export Assets as SVG, PNG, and PDF in Figma",
        "How to Collaborate Live and Share Prototypes in Figma",
        "How to Create Micro-Interactions and Hover States in Figma",
    ],
    "Miro": [
        "How to Set Up an Interactive Whiteboard in Miro",
        "How to Use Miro Templates for Brainstorming and Sprint Planning",
        "How to Use Miro AI to Group and Summarize Sticky Notes",
        "How to Create Flowcharts and User Journey Maps in Miro",
        "How to Run Collaborative Workshops with Miro Timer and Voting",
        "How to Embed Miro Boards into Notion and Confluence",
        "How to Export Miro Boards as High-Resolution PDF or Image",
        "How to Connect Jira and Asana Tasks to Miro Cards",
        "How to Organize Frames and Create Presentations in Miro",
        "How to Manage Team Permissions and Guest Access in Miro",
    ],
    "Loom": [
        "How to Record Screen and Webcam Simultaneously in Loom",
        "How to Use Loom AI to Generate Video Titles, Summaries, and Chapters",
        "How to Edit and Trim Video Recordings in Loom",
        "How to Add Call-to-Action Buttons to Loom Videos",
        "How to Organize Videos into Spaces and Folders in Loom",
        "How to Embed Loom Videos in Notion, Gmail, and Slack",
        "How to Set Video Privacy and Password Protection in Loom",
        "How to View Engagement Analytics and Viewer Insights in Loom",
        "How to Record and Share Loom Clips in Slack",
        "How to Download Loom Video Recordings as MP4",
    ],
    "Slack": [
        "How to Build No-Code Automations with Slack Workflow Builder",
        "How to Use Slack AI to Search and Summarize Channel Conversations",
        "How to Organize Channels, Sections, and Canvas in Slack",
        "How to Connect Google Calendar and Zoom to Slack",
        "How to Set Up Slack Huddles with Screen Sharing and Notes",
        "How to Manage Notifications and Do Not Disturb in Slack",
        "How to Invite External Guests with Slack Connect",
        "How to Create Polls and Surveys in Slack",
        "How to Pin and Bookmark Key Resources in Slack Channels",
        "How to Use Slack User Groups for Quick Mentions",
    ],
    "Zoom": [
        "How to Use Zoom AI Companion for Meeting Summaries and Action Items",
        "How to Set Up and Schedule a Zoom Webinar",
        "How to Create and Manage Breakout Rooms in Zoom",
        "How to Use Zoom Whiteboard for Live Collaboration",
        "How to Record Zoom Meetings to Cloud with Audio Transcripts",
        "How to Connect Zoom with Google Calendar and Outlook",
        "How to Set Up Waiting Rooms and Host Security Controls in Zoom",
        "How to Share Audio and High-Quality Video in Zoom",
        "How to Customize Zoom Virtual Backgrounds and Studio Effects",
        "How to Set Up Zoom Team Chat Channels",
    ],
    "Calendly": [
        "How to Set Up Event Types and Availability in Calendly",
        "How to Connect Google Calendar and Outlook to Calendly",
        "How to Connect Zoom and Google Meet for Auto-Generated Links in Calendly",
        "How to Set Up Automated Email and SMS Reminders in Calendly",
        "How to Create Team Scheduling with Round Robin in Calendly",
        "How to Accept Payments with Stripe and PayPal in Calendly",
        "How to Embed Calendly on Your Website or Landing Page",
        "How to Use Calendly Routing Forms to Qualify Leads",
        "How to Set Up Buffer Times and Daily Meeting Limits in Calendly",
        "How to Connect Calendly to HubSpot and Salesforce",
    ],
    "Typeform": [
        "How to Build Interactive Forms with Logic Jumps in Typeform",
        "How to Connect Typeform to Google Sheets and Notion",
        "How to Collect Payments with Stripe in Typeform",
        "How to Use Typeform AI to Generate Forms Automatically",
        "How to Embed Typeforms into Websites and Webflow",
        "How to Personalize Questions Using Hidden Fields in Typeform",
        "How to Send Automated Follow-Up Emails from Typeform",
        "How to Create Quizzes and Score Calculations in Typeform",
        "How to Connect Typeform to Slack for Instant Lead Notifications",
        "How to Analyze Form Drop-Off Rates in Typeform",
    ],
    "n8n": [
        "How to Build Your First Workflow in n8n",
        "How to Self-Host n8n with Docker",
        "How to Build AI Agents with LangChain in n8n",
        "How to Use Webhook Triggers in n8n",
        "How to Connect PostgreSQL and MySQL in n8n",
        "How to Send Automated Slack and Telegram Alerts with n8n",
        "How to Process JSON and Transform Data in n8n Code Nodes",
        "How to Connect OpenAI ChatGPT API in n8n",
        "How to Set Up Error Trigger Workflows in n8n",
        "How to Use n8n to Sync HubSpot and Airtable",
        "How to Schedule Cron Jobs in n8n",
    ],
    "Hotjar": [
        "How to Install Hotjar Tracking Code on Your Website",
        "How to Set Up and Analyze Heatmaps in Hotjar",
        "How to Filter and Watch Session Recordings in Hotjar",
        "How to Set Up Conversion Funnels in Hotjar",
        "How to Create User Feedback Widgets and Surveys in Hotjar",
        "How to Use Hotjar AI to Generate Insights from User Sessions",
        "How to Track Rage Clicks and U-Turns in Hotjar",
        "How to Integrate Hotjar with Google Analytics 4",
        "How to Mask Sensitive User Data and Credit Cards in Hotjar",
        "How to Share Hotjar Heatmap Reports with Clients",
    ],
    "Looker Studio": [
        "How to Build an Executive Marketing Dashboard in Looker Studio",
        "How to Connect Google Analytics 4 to Looker Studio",
        "How to Connect Google Sheets and CSV Data to Looker Studio",
        "How to Blend Data from Multiple Sources in Looker Studio",
        "How to Create Calculated Fields and Custom Metrics in Looker Studio",
        "How to Add Date Range Filters and Dropdown Controls in Looker Studio",
        "How to Schedule Automated Email Reports in Looker Studio",
        "How to Connect Google Search Console to Looker Studio",
        "How to Customize Chart Colors and Brand Themes in Looker Studio",
        "How to Share and Embed Looker Studio Dashboards",
    ],
    "Semrush": [
        "How to Do Keyword Research with Keyword Magic Tool in Semrush",
        "How to Run a Full Technical SEO Site Audit in Semrush",
        "How to Analyze Competitor Traffic and Keywords in Semrush",
        "How to Track Keyword Rankings with Position Tracking in Semrush",
        "How to Analyze Backlink Profiles and Toxic Links in Semrush",
        "How to Find Keyword Gaps Between Competitors in Semrush",
        "How to Use the On-Page SEO Checker in Semrush",
        "How to Use Semrush AI Writing Assistant for Blog Content",
        "How to Set Up Local SEO and Citation Management in Semrush",
        "How to Generate Automated Client SEO Reports in Semrush",
    ],
    "Klaviyo": [
        "How to Set Up Welcome Email Series in Klaviyo",
        "How to Create Abandoned Cart Flows in Klaviyo",
        "How to Integrate Klaviyo with Shopify and WooCommerce",
        "How to Create Dynamic Customer Segments in Klaviyo",
        "How to Set Up SMS Marketing Campaigns in Klaviyo",
        "How to Design Responsive Email Templates in Klaviyo",
        "How to Set Up Browse Abandonment Email Flows in Klaviyo",
        "How to Run A/B Subject Line Tests in Klaviyo",
        "How to Build Customer Win-Back Flows in Klaviyo",
        "How to Track Revenue and Attribution in Klaviyo",
    ],
    "Brevo": [
        "How to Set Up Email Marketing Campaigns in Brevo",
        "How to Create Automated Email Workflows in Brevo",
        "How to Set Up Transactional SMTP Emails in Brevo",
        "How to Send Bulk SMS Marketing Messages in Brevo",
        "How to Build Landing Pages and Signup Forms in Brevo",
        "How to Integrate Brevo with WordPress and WooCommerce",
        "How to Segment Contacts and Manage Lists in Brevo",
        "How to Use Brevo Conversations Live Chat on Your Website",
        "How to Connect Brevo to Zapier and Make.com",
        "How to Clean Inactive Contacts and Verify Deliverability in Brevo",
    ],
    "DocuSign": [
        "How to Send Documents for Electronic Signature in DocuSign",
        "How to Create Reusable Document Templates in DocuSign",
        "How to Set Up Bulk Send for Multiple Recipients in DocuSign",
        "How to Add Conditional Fields and Checkboxes in DocuSign",
        "How to Set Up Signing Orders and Routing in DocuSign",
        "How to Integrate DocuSign with Google Drive and Salesforce",
        "How to Create Self-Service PowerForms in DocuSign",
        "How to Download Completed Documents and Audit Trails in DocuSign",
        "How to Set Up Automatic Reminder Emails in DocuSign",
        "How to Manage User Permissions and Signer Roles in DocuSign",
    ],
    "PandaDoc": [
        "How to Create Business Proposals and Quotes in PandaDoc",
        "How to Set Up Interactive Pricing Tables in PandaDoc",
        "How to Collect Electronic Signatures in PandaDoc",
        "How to Build Reusable Contract Templates in PandaDoc",
        "How to Connect PandaDoc to HubSpot and Pipedrive",
        "How to Set Up Approval Workflows for Proposals in PandaDoc",
        "How to Accept Online Payments via Stripe in PandaDoc",
        "How to Track Document Views and Recipient Activity in PandaDoc",
        "How to Add Custom Variables and Tokens in PandaDoc",
        "How to Send Automated Reminders for Unsigned Documents in PandaDoc",
    ],
    "Gusto": [
        "How to Run Payroll for Employees and Contractors in Gusto",
        "How to Onboard New Employees and Collect W-4s in Gusto",
        "How to Set Up Health Insurance and 401k Benefits in Gusto",
        "How to Track Employee Hours and PTO in Gusto",
        "How to Integrate Gusto with QuickBooks Online and Xero",
        "How to Calculate and File Payroll Taxes Automatically in Gusto",
        "How to Pay 1099 Contractors with Direct Deposit in Gusto",
        "How to Set Up Custom Garnishment and Deductions in Gusto",
        "How to Generate Year-End W-2 and 1099 Forms in Gusto",
        "How to Run Payroll Reports and Summary Journal Entries in Gusto",
    ],
    "BambooHR": [
        "How to Manage Employee Records and Profiles in BambooHR",
        "How to Set Up Employee Onboarding and Checklists in BambooHR",
        "How to Track Paid Time Off and Leave Approvals in BambooHR",
        "How to Run Performance Reviews and Feedback in BambooHR",
        "How to Build Custom HR Reports and Dashboards in BambooHR",
        "How to Post Jobs and Manage Applicants with BambooHR ATS",
        "How to Set Up Electronic Signatures for Policies in BambooHR",
        "How to Configure Employee Access Levels and Permissions in BambooHR",
        "How to Integrate BambooHR with Slack and Payroll Providers",
        "How to Track Company Asset and Equipment Assignments in BambooHR",
    ],
    "Zendesk": [
        "How to Set Up Support Tickets and Views in Zendesk",
        "How to Create Reusable Macros and Canned Responses in Zendesk",
        "How to Set Up Automated Ticket Triggers and Routing in Zendesk",
        "How to Build a Self-Service Help Center and Knowledge Base in Zendesk",
        "How to Use Zendesk AI Agents to Auto-Resolve Common Issues",
        "How to Connect Support Email Addresses to Zendesk",
        "How to Set Up SLA Policies and Target Response Times in Zendesk",
        "How to Build Customer Support Analytics Dashboards with Zendesk Explore",
        "How to Integrate Zendesk with Slack and Jira",
        "How to Manage Agent Groups and Role Permissions in Zendesk",
    ],
    "Intercom": [
        "How to Install and Customize the Intercom Messenger on Your Site",
        "How to Set Up the Fin AI Copilot and Support Bot in Intercom",
        "How to Manage Team Inboxes and Conversation Routing in Intercom",
        "How to Create Targeted In-App Messages and Popups in Intercom",
        "How to Build Interactive Product Tours in Intercom",
        "How to Create Help Center Articles in Intercom",
        "How to Build Outbound Email and Push Notification Campaigns in Intercom",
        "How to Set Up Custom Data Attributes and User Segmentation in Intercom",
        "How to Integrate Intercom with Salesforce and Stripe",
        "How to Track Customer Satisfaction and CSAT Scores in Intercom",
    ],
    "Webex": [
        "How to Schedule and Host Meetings in Cisco Webex",
        "How to Use Webex AI Assistant for Real-Time Summaries and Action Items",
        "How to Set Up and Broadcast a Webex Webinar",
        "How to Create and Manage Breakout Sessions in Webex",
        "How to Share High-Quality Audio and Video Content in Webex",
        "How to Use the Interactive Whiteboard in Webex",
        "How to Record Meetings to Cloud and Download MP4s in Webex",
        "How to Integrate Webex with Microsoft Outlook and Google Calendar",
        "How to Set Up Virtual Backgrounds and Noise Removal in Webex",
        "How to Manage Account Settings and Security Locks in Webex",
    ]
}

# Also gather existing matched keywords from files in Keywords/ and CSVs
collected_keywords = []

# Add curated first
id_counter = 1
for tool_name, titles in curated_keywords_by_tool.items():
    for t in titles:
        collected_keywords.append({
            'id': id_counter,
            'title': t.strip(),
            'software': tool_name,
            'content_type': 'Tutorial',
            'length_class': '<3min',
            'duration_sec': 140,
            'reference_url': None,
            'status': 'NEW'
        })
        id_counter += 1

print(f"Curated base keywords added: {len(collected_keywords)}")

# Scan existing keywords from local files
kw_folder = r'C:\Users\konra\OneDrive\YouTube\Projekte\YTA Tutorials\Keywords'
for f in glob.glob(os.path.join(kw_folder, '*')):
    if f.endswith('.txt'):
        base = os.path.splitext(os.path.basename(f))[0].lower()
        matched_software = aliases_to_tool.get(base)
        if matched_software:
            with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
                for line in fp:
                    line = line.strip()
                    if not line or line.startswith('#') or len(line) < 6:
                        continue
                    # format to "How to ..."
                    clean_t = line
                    if not clean_t.lower().startswith('how to'):
                        clean_t = 'How to ' + clean_t
                    # title case
                    clean_t = ' '.join([w.capitalize() if w.lower() not in ['to', 'and', 'in', 'on', 'with', 'for', 'a', 'an', 'the', 'vs', 'or', 'of', 'from', 'into', 'by'] else w.lower() for w in clean_t.split()])
                    clean_t = clean_t[0].upper() + clean_t[1:]
                    
                    # check deduplication
                    if not any(k['title'].lower() == clean_t.lower() for k in collected_keywords):
                        collected_keywords.append({
                            'id': id_counter,
                            'title': clean_t,
                            'software': matched_software,
                            'content_type': 'Tutorial',
                            'length_class': '<3min',
                            'duration_sec': 150,
                            'reference_url': None,
                            'status': 'NEW'
                        })
                        id_counter += 1

print(f"Total collected keywords after file scan: {len(collected_keywords)}")

# Count per software
from collections import Counter
counts = Counter([k['software'] for k in collected_keywords])
for t_num in sorted(tools_map.keys()):
    t_name = tools_map[t_num]['name']
    print(f"{t_num:2d}. {t_name:20s}: {counts.get(t_name, 0)} keywords")

# Generate SQL migration file
sql_lines = [
    "-- Migration 0065_seed_keywords.sql",
    "-- Re-seeded strictly for the 37 Verified Global Tutorial Gaps (Business Software Tools)",
    "",
    "CREATE TABLE IF NOT EXISTS seed_keywords (",
    "  id           integer PRIMARY KEY,",
    "  title        text NOT NULL,",
    "  software     text,",
    "  content_type text,",
    "  length_class text,",
    "  duration_sec integer,",
    "  video_id     text,",
    "  status       text NOT NULL DEFAULT 'NEW',",
    "  claimed_by   text,",
    "  claimed_at   timestamptz,",
    "  deleted_at   timestamptz,",
    "  done_at      timestamptz,",
    "  created_at   timestamptz NOT NULL DEFAULT now()",
    ");",
    "",
    "CREATE INDEX IF NOT EXISTS idx_seed_keywords_length ON seed_keywords (length_class);",
    "CREATE INDEX IF NOT EXISTS idx_seed_keywords_software ON seed_keywords (software);",
    "CREATE INDEX IF NOT EXISTS idx_seed_keywords_status ON seed_keywords (status);",
    "",
    "TRUNCATE TABLE seed_keywords;",
    ""
]

values_list = []
for k in collected_keywords:
    title_esc = k['title'].replace("'", "''")
    soft_esc = k['software'].replace("'", "''")
    values_list.append(f"({k['id']}, '{title_esc}', '{soft_esc}', '{k['content_type']}', '{k['length_class']}', {k['duration_sec']}, 'NEW', now())")

chunk_size = 50
for i in range(0, len(values_list), chunk_size):
    chunk = values_list[i:i+chunk_size]
    sql_lines.append("INSERT INTO seed_keywords (id, title, software, content_type, length_class, duration_sec, status, created_at) VALUES")
    sql_lines.append(",\n".join(chunk) + ";")
    sql_lines.append("")

output_sql = "\n".join(sql_lines)
with open(r'c:\Users\konra\OneDrive\Projekte\20260816 TutorialProductionLine\packages\db\src\migrations\0065_seed_keywords.sql', 'w', encoding='utf-8') as fp:
    fp.write(output_sql)

with open(r'c:\Users\konra\OneDrive\Projekte\20260816 TutorialProductionLine\scratch\reseed_37_keywords.sql', 'w', encoding='utf-8') as fp:
    fp.write(output_sql)

# Also write JSON artifact for the UI / API fallback
with open(r'c:\Users\konra\OneDrive\Projekte\20260816 TutorialProductionLine\apps\hub-web\src\lib\tutorial\seed-37-keywords.json', 'w', encoding='utf-8') as fp:
    json.dump(collected_keywords, fp, indent=2)

print("Successfully written SQL and JSON seed data!")
