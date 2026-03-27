# 📘 Azure Resiliency Assessment Tool – README
## ⚠️ Disclaimer

This tool and associated scripts are provided for **informational and assessment purposes only** and do not represent an official Microsoft product or supported solution.

All outputs are generated based on available Azure metadata and configuration at the time of execution. As such:
- Results may not fully reflect actual application behavior, dependencies, or runtime resiliency.
- Certain edge cases, service-specific behaviors, or architectural nuances may not be captured.
- Azure services, features, and behaviors are subject to change over time.

This tool does **not replace architecture validation, resiliency testing, or design reviews**.

Customers are responsible for:
- Validating all findings  
- Performing appropriate testing (including failover and recovery scenarios)  
- Ensuring alignment with their specific requirements, policies, and risk posture  

No warranties, guarantees, or support obligations are provided with this tool.

## 📌 Overview

The **RAISEiliency tool** scans Azure resources across subscriptions and consolidates **resiliency-related configurations** into structured outputs for easier analysis.

The objective is to provide **clear visibility of zone redundancy, resiliency posture, and potential gaps** across your Azure environment.

---

## 🎯 What the Tool Extracts

The script collects and reports on:

- Availability Set placement  
- Availability Zone (AZ) mapping across subscriptions  
- AZ redundancy configuration  
- AZ pinning (zonal resources)  
- Same-zone / zonal high availability for supported PaaS services  
- Capacity distribution across zones  
- Storage resiliency configuration (LRS, ZRS, GRS, etc.)  
- Backup resiliency configuration  
- Public IP exposure and association  
- Resource relationships (e.g., VM → NIC → Public IP)  

---

## ⚙️ Requirements

### 🔹 Azure Permissions
- Minimum required role: **Reader** on all target subscriptions  

### 🔹 PowerShell Setup

#### ✅ Option 1 – Azure Cloud Shell (Recommended)

It is **recommended to run the script in Azure Cloud Shell** because:
- All required modules (Az, Resource Graph) are already installed  
- No local setup is required  
- Authentication is handled automatically  

👉 This avoids most prerequisite and environment issues.

---

#### 🖥️ Option 2 – Local Machine

Install Azure PowerShell modules:

```powershell
Install-Module -Name Az -Repository PSGallery -Force
```

Ensure:
- **Az.ResourceGraph** module is available  
- You are authenticated:

```powershell
Connect-AzAccount
```

---

## 🚀 How to Use

### 🔹 Define Customer Tags (Optional but Recommended)
These tag names should correspond to the **Azure resource tags used in your environment** (e.g., Environment, Application, Business Unit). The script will extract the values of these tags for each resource and include them in the output, enabling **filtering, grouping, and slice-and-dice analysis in Power BI dashboards** to better understand resiliency posture per workload.
```powershell
$custTags=('Environment','Business Unit','Application','AssetClassification')
```

---

### 🔹 Example Usage

#### ✅ Example 1 – Target Specific Subscriptions

```powershell
.\RelAZ_Assess_v2_18.ps1 `
  -localexport $true `
  -Customertags $custTags `
  -targetSubscriptions @(
    'xxxxxx-xxxx-xxx-xxxx-xxxxxxxxxxx',
    'yyyy-yyyy-yyyy-yyy-yyyyyyyyyyyy'
  )
```

---

#### ✅ Example 2 – Using Management Group Scope

```powershell
.\RelAZ_Assess_v2_18.ps1 `
  -localexport $true `
  -managementGroupId @('MG1','ContosoSamir') `
  -Customertags $custTags 
```

---

## ⚙️ Script Parameters

| Parameter | Description |
|----------|------------|
| `-localexport` | Enables export of results to local CSV files , it creates a folder and a zip file |
| `-Customertags` | Array of tag names used to identify workloads |
| `-targetSubscriptions` |(optional) List of subscription IDs to include in the scan |
| `-managementGroupId` | (Optional) Scope the scan to a specific management group |

---

## 📊 Output Files

When `-localexport $true` is enabled, the script generates the following files:

- **MasterReport.csv**  
  Main output file containing the consolidated view of all scanned resources, including:
  - Zone configuration (zonal / non-zonal / zone-redundant)
  - Resiliency-related properties
  - Tags (if provided)
  - Key relationships between resources  
  👉 This is the primary dataset used for analysis and Power BI dashboards.

---

- **asr_backup.csv**  
  Inventory of resources with backup or disaster recovery configurations, including:
  - Backup status  
  - Last backup information (where available)  
  - ASR replication details  

---

- **pipReport.csv**  
  Public IP inventory, including:
  - Associated resources  
  - Zone configuration  
  - Exposure insights  

---

- **zonemapping.csv**  
  Mapping of Availability Zones to physical zones across subscriptions.  
  👉 Useful to understand how logical zone numbers (1,2,3) align across subscriptions.

---

- **lbReport.csv**  
  Load Balancer configuration details, including:
  - Frontend configurations  
  - Associated Public IPs  
  - Zone setup  

---

- **CustomerAzRetirements.csv**  
  Lists Azure services/resources in the environment that are:
  - Retired  
  - Or approaching retirement  
  👉 Helps identify modernization or migration needs.

---

- **Azureretirements.json**  
  Reference file used to map retirement information and enrich the retirement report.

---

## 📌 Notes

- All files are **CSV-based and ready for direct consumption** in:
  - Excel  
  - Power BI  

- **MasterReport.csv is the central dataset** and should be used as the primary source for analysis.

- Other files provide **supporting datasets** to enrich visibility on:
  - Backup & DR posture  
  - Network exposure  
  - Zone alignment  
  - Platform lifecycle (retirements)

When `-localexport $true` is enabled, the script generates:

- **CSV files per resource provider**
- Each file includes:
  - Resource details  
  - Expanded properties  
  - Tags  
  - Zone and resiliency-related configurations  

These outputs are:
- Raw but structured  
- Designed for further processing (e.g., Excel, Power BI)

---
## 📊 Visualization with Power BI

The exported data can be visualized using the provided Power BI template:

**`ReliabilityAssessment_Template_Vx.x.pbit`**

---

### ⚙️ Prerequisites

- **Power BI Desktop** installed (required to open `.pbit` template files)  
- Access to the folder containing the exported CSV files  
- (Optional) Power BI Service (PowerBI Web) account for publishing and sharing  

---

### 🚀 How to Use

1. Open the template file (double click), this will open **Power BI Desktop**
2. When prompted, provide the **export folder path** (the folder generated by the script): for example C:\Resiliency Scripts\20260324

3. Click **Load**

Power BI will automatically:
- Import all CSV files  
- Build the data model  
- Populate all visuals and dashboards  

---

### ☁️ Publishing (Optional)

Once the report is loaded and validated you can save it locally or:

- You can publish it to **Power BI Service (PowerBI Web)**  
- This enables:
- Sharing dashboards with stakeholders  
- Centralized access  
- Scheduled refresh (if configured)  

---

## 📈 Dashboard Overview

The template provides multiple tabs to analyze resiliency posture from different perspectives:

---

### 🔹 ResourceSummary

- High-level overview of all resources  
- Shows:
- Resource count by type  
- Distribution by resiliency configuration (Zonal, Zone-Redundant, Non-Zonal, etc.)  

👉 Used for quick understanding of the **overall resiliency posture**

---

### 🔹 AssessmentSummary

- Aggregated view per:
- Subscription  
- Resource Group  

- Provides:
- Percentage of resilient resources  
- Classification (e.g., >90%, 75–90%, <50%)

👉 Used to identify **weak areas and prioritize remediation**

---

### 🔹 ALL_Resources

- Full detailed inventory of all scanned resources  
- Includes:
- Resource name, type, region  
- Zone configuration  
- Backup and resiliency details  

👉 Used for **deep-dive analysis and troubleshooting**

---

### 🔹 ApplicationDetails

- View filtered using **customer-defined tags** (Application, Environment, etc.)  
- Enables:
- Workload-level analysis  
- Application-specific insights  

👉 Used to align findings with **business workloads**

---

### 🔹 by PhysicalZone

- Displays distribution of resources across **physical zones**  
- Helps identify:
- Imbalance in zone usage  
- Concentration risks  

👉 Used to validate **actual zone distribution and resilience**

---

### 🔹 Backup

- Shows backup posture:
- Protected resources  
- Backup status (Healthy / Failed)  
- Last backup time  

👉 Used to assess **data protection readiness**

---

### 🔹 ASR

- Displays disaster recovery (ASR) configuration:
- Replication health  
- Failover status  
- Source and target regions  

👉 Used to evaluate **disaster recovery readiness**

---

### 🔹 Config Changes

- Provides insights into configuration-related changes (if applicable)

👉 Used for **operational monitoring and tracking**

---

## 📌 Notes

- The dashboard is primarily driven by:
- **MasterReport.csv (main dataset)**  
- Supporting datasets (Backup, ASR, Networking, etc.)

- Filters available across reports:
- Subscription  
- Resource Group  
- Resource Type  
- Environment  
- Resiliency Configuration  

👉 These enable **slice-and-dice analysis across multiple dimensions**

---

## 🧠 Key Value

Using Power BI with this tool allows you to:

- Transform raw data into **actionable insights**  
- Identify **resiliency gaps at scale**  
- Align infrastructure posture with **business workloads**  
- Support **data-driven decision making and prioritization**  

---
## 📊 How to Interpret Results

### 🔹 Virtual Machines

- **Non-zonal VM**
  - ❗ Not protected against zone failure  

- **Zonal VM**
  - ✅ Good baseline  
  - ⚠️ Must verify:
    - Multiple instances exist  
    - Instances are distributed across different zones  

👉 This distribution cannot be automatically validated because:
- The script cannot infer application roles or workload grouping  

---

### 🔹 General Classification

| Status | Meaning |
|-------|--------|
| Zone-Redundant | Highest resiliency (platform-managed) |
| Zonal | Requires proper distribution across zones |
| Non-Zonal | Potential single point of failure |

---

## 🧠 Tagging Guidance

Providing meaningful tags is critical.

Recommended tags:
- Environment (Prod / Dev / UAT)  
- Application name  
- Business unit  
- Project / workload identifier  

If no tags are provided:
- Analysis will be limited to resource-level only  
- Workload-level insights will be harder to derive  

---

## ⚠️ Limitations & Important Considerations

This tool provides **infrastructure-level insights only** and must not be considered as a full validation of resiliency.

### 🔹 What the Tool Does NOT Do

- It does **not validate application architecture**
- It does **not confirm high availability at workload level**
- It does **not simulate failover scenarios**
- It does **not understand application dependencies or roles**

---

### 🔹 Example – Virtual Machines

- A VM marked as **zonal** is often interpreted as “resilient”  
- However, this is **not sufficient**

👉 The tool cannot determine:
- If multiple VMs belong to the same application tier  
- If those VMs are correctly distributed across zones  
- If the application can actually fail over between instances  

➡️ Example risk:
- 3 VMs of the same role all deployed in **Zone 1** → still a **single point of failure**, even if they are “zonal”

---

### 🔹 Human Review is Mandatory

The output of this tool **must be reviewed by someone who understands the application architecture**, including:

- Application owners  
- Cloud architects  
- Platform engineers  

This review is required to:
- Validate workload distribution  
- Confirm actual high availability design  
- Identify real resiliency gaps  

---

## 📝 Recommended Next Steps

1. Identify **non-zonal resources**  
2. Validate **zonal distribution across workloads**  
3. Engage application owners for **architecture validation**  
4. Prioritize **critical workloads for remediation**  
5. Import CSV outputs into:
     
   - Power BI  

---

## 📌 Summary

The RAISEiliency tool enables:

- Large-scale visibility of **zone resiliency posture**  
- Identification of **configuration gaps**  
- Structured data export for **analysis and reporting**  

It should be used as:

👉 A **foundation for resiliency assessment**, followed by:
- Architecture validation  
- Workload-level design review  
- Failover and resiliency testing  
