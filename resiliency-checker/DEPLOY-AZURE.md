# Deploying the ADGE Resiliency Checker to Azure (private, VNet-integrated)

End-to-end, self-contained runbook. Target architecture:

- **Azure App Service (Linux, Node 20, B1)** running the app as **code** (no Docker, no ACR). B1 is the cheapest tier that supports VNet integration + private endpoints; switch to **S1** if you want deployment slots (cleaner post-lockdown redeploys) or **P1v3** for autoscale/zone redundancy.
- **Azure Files** share holding the `MasterReport.csv` data, reached over a **private endpoint**.
- **Regional VNet integration** (app outbound) + **private endpoints** for both the app and storage.
- **Entra ID (Easy Auth)** for authentication, restricted to a security group.
- App is **not reachable from the public internet** — only from the ADGOV network.

> Run every block in **PowerShell** with the Azure CLI. Do the steps **in order** — the lockdown steps (12, 15) must come last, or you'll cut off your own deployment path.
>
> **Already have a VNet?** (landing-zone / brownfield) — follow the main steps for everything except networking, and use **[Appendix A](#appendix-a--variant-the-vnet-already-exists-landing-zone--brownfield)** in place of Sections 4, 10, 11, and the PE bits of 12/14.

---

## 0. Workstation prerequisites (one-time)

- **Azure CLI** — https://aka.ms/installazurecli  (check: `az version`)
- **AzCopy** — https://aka.ms/downloadazcopy  (for uploading CSVs)
- Your account needs, in the target subscription: **Contributor** (create resources) + **User Access Administrator** or the ability to create the Entra app registration for Easy Auth. For the group restriction you need to manage the Enterprise Application (or ask an Entra admin).

---

## 1. Variables — edit these, then paste the block

```powershell
$SUB     = "<your-subscription-id>"
$RG      = "rg-adge-resiliency"
$LOC     = "uaenorth"
$APP     = "adge-resiliency-checker"          # must be globally unique
$PLAN    = "plan-adge-resiliency"
$STG     = "stadgeresil$((Get-Random -Max 9999))"  # 3-24 lowercase, globally unique
$SHARE   = "data-root"
$VNET    = "vnet-adge-resiliency"
$SNETIN  = "snet-appsvc-int"                   # delegated to App Service
$SNETPE  = "snet-private-endpoints"
$PROJ    = "C:\ADGE Resiliency\resiliency-checker"
$DATASRC = "C:\ADGE Resiliency\ADGEs Assessment Reports"  # local CSV source
$VIEWERGROUP = "DGE-Resiliency-Viewers"        # Entra group allowed to sign in
```

## 2. Sign in

```powershell
az login
az account set --subscription $SUB
```

## 3. Resource group

```powershell
az group create --name $RG --location $LOC
```

## 4. Virtual network + two subnets

```powershell
# VNet + integration subnet
az network vnet create -g $RG -n $VNET --location $LOC --address-prefixes 10.20.0.0/16 `
  --subnet-name $SNETIN --subnet-prefixes 10.20.1.0/24

# Private-endpoint subnet
az network vnet subnet create -g $RG --vnet-name $VNET -n $SNETPE --address-prefixes 10.20.2.0/24
az network vnet subnet update  -g $RG --vnet-name $VNET -n $SNETPE `
  --disable-private-endpoint-network-policies true

# Delegate the integration subnet to App Service
az network vnet subnet update -g $RG --vnet-name $VNET -n $SNETIN `
  --delegations Microsoft.Web/serverFarms
```

## 5. Storage account + file share

```powershell
az storage account create --name $STG --resource-group $RG --location $LOC `
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false

$KEY = az storage account keys list --account-name $STG --resource-group $RG --query "[0].value" -o tsv

az storage share-rm create --resource-group $RG --storage-account $STG --name $SHARE --quota 5
```

## 6. App Service Plan (B1, Linux) + Web App (Node 20)

> **SKU choice:** `B1` (default here) is the cheapest tier supporting VNet integration + private endpoints — right for a low-traffic internal dashboard. Use `S1` if you want **deployment slots** (deploy to a private staging slot and swap, avoiding the jumpbox for redeploys), or `P1V3` for autoscale/zone redundancy. Just change `--sku` below.

```powershell
az appservice plan create --name $PLAN --resource-group $RG --location $LOC --is-linux --sku B1

az webapp create --name $APP --resource-group $RG --plan $PLAN --runtime "NODE:20-lts"

az webapp config set --name $APP --resource-group $RG --startup-file "node server/index.js"
```

## 7. Deploy the app code — WHILE STILL PUBLIC

> ⚠️ **Do NOT use `Compress-Archive`** — it writes zip entries with backslash separators
> that Linux App Service (rsync) rejects with `failed to stat ".../server\index.js":
> Invalid argument (22)`. Build the zip with forward-slash entries as below.

```powershell
cd "$PROJ"

# Stage only the app files
$stage = Join-Path $env:TEMP "rc-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item .\server $stage -Recurse
Copy-Item .\public $stage -Recurse
Copy-Item .\data   $stage -Recurse
Copy-Item .\package.json $stage

# Zip with FORWARD-SLASH entry names (Linux-safe)
$zipPath = "$PROJ\deploy.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
$root = (Resolve-Path $stage).Path
Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
  $entry = $_.FullName.Substring($root.Length + 1) -replace '\\','/'
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry) | Out-Null
}
$zip.Dispose()

# Zero dependencies -> no build needed
az webapp config appsettings set -n $APP -g $RG --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false
az webapp deploy --name $APP --resource-group $RG --src-path $zipPath --type zip
```

> **Simplest alternative:** `cd "$PROJ"; az webapp up --name $APP --resource-group $RG --runtime "NODE:20-lts" --sku B1`
> — az CLI zips via Python (forward slashes, no backslash bug), but it packages the *whole*
> folder (README, logs, Dockerfile, etc.). The staged zip above is cleaner.

## 8. Mount the file share + point the app at it

```powershell
az webapp config storage-account add --name $APP --resource-group $RG `
  --custom-id dataroot --storage-type AzureFiles `
  --account-name $STG --share-name $SHARE --access-key $KEY --mount-path /data-root

az webapp config appsettings set --name $APP --resource-group $RG `
  --settings DATA_ROOT=/data-root WEBSITE_VNET_ROUTE_ALL=1

az webapp restart --name $APP --resource-group $RG
```

## 9. Upload the CSV data (preserve folder structure)

Structure required: `<Entity>\<RunDate>\MasterReport.csv` (RunDate = `YYYY-MM-DD`).

```powershell
$SAS = az storage share generate-sas --account-name $STG --account-key $KEY `
  --name $SHARE --permissions dlrw `
  --expiry (Get-Date).AddHours(2).ToString("yyyy-MM-ddTHH:mmZ") -o tsv

azcopy copy "$DATASRC\*" "https://$STG.file.core.windows.net/$SHARE?$SAS" --recursive
```

**Checkpoint:** open the app (still public) and confirm dashboards show your entities:
```powershell
az webapp browse --name $APP --resource-group $RG
```
The server rescans every 5 min; new dated folders appear automatically.

## 10. Regional VNet integration (app outbound)

```powershell
az webapp vnet-integration add -g $RG -n $APP --vnet $VNET --subnet $SNETIN
# route-all already set in step 8 so SMB to the storage PE goes through the VNet
```

## 11. Private DNS zones (app + files) linked to the VNet

```powershell
foreach ($z in @("privatelink.file.core.windows.net","privatelink.azurewebsites.net")) {
  az network private-dns zone create -g $RG -n $z
  az network private-dns link vnet create -g $RG -z $z -n ("link-" + $z.Split('.')[1]) `
    --virtual-network $VNET --registration-enabled false
}
```

## 12. Private endpoint for STORAGE + lock storage down

```powershell
$STGID = az storage account show -g $RG -n $STG --query id -o tsv

az network private-endpoint create -g $RG -n "pe-$STG-file" --location $LOC `
  --vnet-name $VNET --subnet $SNETPE `
  --private-connection-resource-id $STGID --group-id file --connection-name "c-$STG-file"

az network private-endpoint dns-zone-group create -g $RG --endpoint-name "pe-$STG-file" `
  -n zg --private-dns-zone "privatelink.file.core.windows.net" --zone-name file

# Now block public access to storage — app reaches it privately via VNet
az storage account update -g $RG -n $STG --public-network-access Disabled

az webapp restart --name $APP --resource-group $RG
```

**Checkpoint:** app (still public inbound) must still load data — proving the private path to Files works. If it 500s on data, wait 2-3 min for DNS/PE propagation and restart again.

## 13. Authentication — Entra ID Easy Auth (Portal, no code change)

1. Azure Portal -> Web App **adge-resiliency-checker** -> **Settings > Authentication**.
2. **Add identity provider** -> **Microsoft**.
3. App registration: **Create new** (default name = app name).
4. Supported account types: **Current tenant - single tenant**.
5. Restrict access: **Require authentication**.
6. Unauthenticated requests: **HTTP 302 Found (redirect to Microsoft)**.
7. **Add**. Every visitor now must sign in with a tenant account.

**Restrict to specific people/group:**
1. Portal -> **Microsoft Entra ID > Enterprise applications** -> open the app (same name).
2. **Properties** -> **Assignment required?** = **Yes** -> Save.
3. **Users and groups** -> **Add user/group** -> assign the `DGE-Resiliency-Viewers` group.

Only assigned identities can reach the app; everyone else is blocked at sign-in.

## 14. Private endpoint for the WEB APP + block public inbound (LAST)

> After this, Kudu/zip-deploy from the internet stops working. Only do it once the app is verified.

```powershell
$APPID = az webapp show -g $RG -n $APP --query id -o tsv

az network private-endpoint create -g $RG -n "pe-$APP-sites" --location $LOC `
  --vnet-name $VNET --subnet $SNETPE `
  --private-connection-resource-id $APPID --group-id sites --connection-name "c-$APP-sites"

az network private-endpoint dns-zone-group create -g $RG --endpoint-name "pe-$APP-sites" `
  -n zg --private-dns-zone "privatelink.azurewebsites.net" --zone-name sites

# Block all public inbound — app now only reachable via its private endpoint
az webapp update -g $RG -n $APP --set publicNetworkAccess=Disabled
```

## 15. On-prem / ADGOV DNS resolution

For users on the ADGOV network (ExpressRoute/VPN) to reach the app by its FQDN
(`adge-resiliency-checker.azurewebsites.net`), on-prem DNS must resolve the
`privatelink.azurewebsites.net` records to the private IP. Ensure one of:

- On-prem conditional forwarder -> **Azure DNS Private Resolver** inbound endpoint in this VNet, or
- Existing DNS forwarders that reach the linked private DNS zones.

Without this, the private FQDN won't resolve from on-prem and the app appears unreachable.

## 16. Final verification

- From an ADGOV-connected machine with an **assigned** account: browse the app FQDN ->
  Microsoft sign-in -> dashboards load with entity data.
- A **non-assigned** account -> blocked ("needs assignment").
- From the public internet -> not reachable (name resolves to private IP / connection refused).

---

## Redeploying after lockdown

Once the app's public access is disabled, deploy from **inside the VNet**:

- **Jumpbox VM** in `snet-private-endpoints` (or a 3rd subnet): copy `deploy.zip`, run
  `az webapp deploy ... --type zip` from there, or
- **Deployment slot swap** (S1+ only — B1 has no slots): deploy to a private staging slot, then `az webapp deployment slot swap`, or
- **Self-hosted GitHub/DevOps agent** in the VNet, or
- Temporarily re-enable public + add an **Access restriction** allowing only your IP:
  ```powershell
  az webapp update -g $RG -n $APP --set publicNetworkAccess=Enabled
  az webapp config access-restriction add -g $RG -n $APP --rule-name deployme `
    --action Allow --ip-address <your-public-ip>/32 --priority 100
  # deploy, then revert:
  az webapp update -g $RG -n $APP --set publicNetworkAccess=Disabled
  ```

## Persisting Settings-UI tuning across redeploys

`data/config.json` lives in the deployment; a redeploy overwrites it. If you tune scoring
via the Settings view after go-live, either re-export that `config.json` into the project
before the next deploy, or move it to the mounted share and adjust `STORE_DIR`.

## Quick troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| App loads but no entities | `DATA_ROOT` wrong, or share empty. Check app setting = `/data-root`; confirm CSVs uploaded with the `<Entity>\<RunDate>\` structure. |
| 500 on data after storage lockdown | DNS/PE not propagated. Wait 2-3 min, `az webapp restart`. Confirm `WEBSITE_VNET_ROUTE_ALL=1` and VNet integration attached. |
| Can't reach app from on-prem | Private DNS resolution missing (Section 15). |
| Deploy fails after lockdown | Expected — deploy from inside the VNet (see above). |
| Deploy 400 / `failed to stat "...\file": Invalid argument (22)` | Zip built with `Compress-Archive` (backslash entries). Rebuild with the forward-slash method in Section 7, or use `az webapp up`. |
| Sign-in works but everyone can enter | "Assignment required = Yes" not set, or group not assigned. |

---

# Appendix A — Variant: the VNet already exists (landing-zone / brownfield)

In an ADGOV landing zone the VNet usually already exists (often in a **hub/connectivity
subscription**, peered to your spoke) and **private DNS is centrally managed** by policy.
Use this variant instead of Sections 4, 10, 11, 12, 14's networking bits. Everything else
(Sections 5-9, 13, 15, 16) is unchanged.

## A.1 Extra variables

```powershell
# The existing VNet — may live in a different RG (and even a different subscription)
$VNET_RG = "rg-connectivity-hub"      # RG that holds the existing VNet
$VNET    = "vnet-adgov-spoke"         # existing VNet name
$VNET_ID = az network vnet show -g $VNET_RG -n $VNET --query id -o tsv
```

> If the VNet is in **another subscription**, either run subnet/DNS commands with
> `--subscription <vnet-sub>` or have the network team pre-create the subnets. The web app,
> plan, storage, and private endpoints still go in **your** RG/subscription.

## A.2 Subnets — pick one case

You need two subnets: an **integration subnet** (dedicated + delegated to
`Microsoft.Web/serverFarms`, must be empty) and a **private-endpoint subnet**.

**Case A — the landing zone already provides them** (ask the network team for names):
```powershell
$SNETIN = "snet-appsvc-int"           # existing, delegated to Microsoft.Web/serverFarms
$SNETPE = "snet-private-endpoints"

# Verify the integration subnet is delegated correctly:
az network vnet subnet show -g $VNET_RG --vnet-name $VNET -n $SNETIN `
  --query "delegations[].serviceName" -o tsv     # must print Microsoft.Web/serverFarms
```

**Case B — you may add subnets to the existing VNet** (needs free address space + rights):
```powershell
az network vnet subnet create -g $VNET_RG --vnet-name $VNET -n $SNETIN `
  --address-prefixes 10.20.10.0/27 --delegations Microsoft.Web/serverFarms

az network vnet subnet create -g $VNET_RG --vnet-name $VNET -n $SNETPE `
  --address-prefixes 10.20.10.32/27
az network vnet subnet update -g $VNET_RG --vnet-name $VNET -n $SNETPE `
  --disable-private-endpoint-network-policies true
```
> Choose prefixes that don't overlap anything already in the VNet — confirm with the network team.

Capture the subnet IDs (used by the cross-RG commands below):
```powershell
$SNETIN_ID = az network vnet subnet show -g $VNET_RG --vnet-name $VNET -n $SNETIN --query id -o tsv
$SNETPE_ID = az network vnet subnet show -g $VNET_RG --vnet-name $VNET -n $SNETPE --query id -o tsv
```

## A.3 Replaces Section 4

**Skip Section 4 entirely** — do not create a VNet or subnets (unless using Case B above).

## A.4 Replaces Section 10 — VNet integration (by subnet ID, cross-RG safe)

```powershell
az webapp vnet-integration add -g $RG -n $APP --vnet $VNET_ID --subnet $SNETIN
# If that errors across RGs/subscriptions, target the subnet resource ID directly:
#   az webapp vnet-integration add -g $RG -n $APP --subnet $SNETIN_ID

az webapp config appsettings set -g $RG -n $APP --settings WEBSITE_VNET_ROUTE_ALL=1
```

## A.5 Replaces Section 11 — Private DNS (decision point)

**First check whether central private DNS zones already exist** (hub/connectivity sub):
```powershell
az network private-dns zone list `
  --query "[?contains(name,'privatelink')].[name,resourceGroup]" -o table
```

- **Central zones exist (typical landing zone):** ⚠️ **Do NOT create your own zones or
  `dns-zone-group`.** Just create the private endpoints (A.6). A platform **DINE policy**
  usually auto-registers the A-records in the hub-hosted zones. If it doesn't, ask the
  network team to add the `dns-zone-group` pointing at *their* zone IDs, or supply the zone
  resource IDs so you can. **Creating parallel zones causes split-brain DNS.**

- **No central zones exist:** create them in your RG and link to the **existing** VNet:
  ```powershell
  foreach ($z in @("privatelink.file.core.windows.net","privatelink.azurewebsites.net")) {
    az network private-dns zone create -g $RG -n $z
    az network private-dns link vnet create -g $RG -z $z -n ("link-" + $z.Split('.')[1]) `
      --virtual-network $VNET_ID --registration-enabled false
  }
  ```

## A.6 Replaces the PE creation in Sections 12 & 14 — target the existing PE subnet

Use `--subnet $SNETPE_ID` (no `--vnet-name`). Omit the `dns-zone-group` step when DNS is
centrally managed (A.5, central case).

```powershell
# --- Storage private endpoint (Section 12) ---
$STGID = az storage account show -g $RG -n $STG --query id -o tsv
az network private-endpoint create -g $RG -n "pe-$STG-file" --location $LOC `
  --subnet $SNETPE_ID `
  --private-connection-resource-id $STGID --group-id file --connection-name "c-$STG-file"

# Only if you self-manage DNS (A.5, no-central case):
az network private-endpoint dns-zone-group create -g $RG --endpoint-name "pe-$STG-file" `
  -n zg --private-dns-zone "privatelink.file.core.windows.net" --zone-name file

az storage account update -g $RG -n $STG --public-network-access Disabled
az webapp restart --name $APP --resource-group $RG

# --- App private endpoint (Section 14, do LAST) ---
$APPID = az webapp show -g $RG -n $APP --query id -o tsv
az network private-endpoint create -g $RG -n "pe-$APP-sites" --location $LOC `
  --subnet $SNETPE_ID `
  --private-connection-resource-id $APPID --group-id sites --connection-name "c-$APP-sites"

# Only if you self-manage DNS:
az network private-endpoint dns-zone-group create -g $RG --endpoint-name "pe-$APP-sites" `
  -n zg --private-dns-zone "privatelink.azurewebsites.net" --zone-name sites

az webapp update -g $RG -n $APP --set publicNetworkAccess=Disabled
```

## A.7 Permissions required on the existing VNet

Since the VNet isn't in your RG, your identity needs at least:

- **`Microsoft.Network/virtualNetworks/subnets/join/action`** on both subnets
  (included in **Network Contributor** on the VNet or subnet scope) — required for both
  VNet integration and private endpoints.
- Rights to **link** a private DNS zone to the VNet (only if self-managing DNS).

If you only hold rights on your spoke RG, the network/platform team must pre-create and
delegate the subnets and (for central DNS) register the private-endpoint records.

## A.8 On-prem DNS (unchanged, but note the source)

Section 15 still applies. With central DNS, on-prem resolution to the private IPs is usually
already wired through the hub's DNS Private Resolver / forwarders — confirm with the network
team rather than standing up your own.
