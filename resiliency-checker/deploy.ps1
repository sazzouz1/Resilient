# ============================================================
#  ADGE Resiliency Checker — private-from-inception deployment
#  Existing VNet reused · App Service S1 · Azure Files (BYOS)
#  Entra Easy Auth · code push via `az webapp up`
# ============================================================

# ---- Variables ----
$SUB     = "7f7d39e9-8ccb-4f6d-bca2-d61dd2c646cc"
$RG      = "rg-adge-resiliency"
$LOC     = "uaenorth"
$APP     = "adge-resiliency-checker2"                 # must be globally unique
$PLAN    = "plan-adge-resiliency"
$STG     = "stadgeresil$((Get-Random -Max 9999))"    # 3-24 lowercase, globally unique
$SHARE   = "data-root"
$VNET    = "vnet-adge-resiliency"                    # EXISTING VNet
$SNETIN  = "snet-appsvc-int"                         # delegated to App Service
$SNETPE  = "snet-private-endpoints"
$PROJ    = "C:\ADGE Resiliency\resiliency-checker"
$DATASRC = "C:\ADGE Resiliency\ADGEs Assessment Reports"   # local CSV source
$VIEWERGROUP = "DGE-Resiliency-Viewers"              # Entra group allowed to sign in

# Private DNS zone names (fixed by Azure)
$DNS_FILE = "privatelink.file.core.windows.net"
$DNS_SITE = "privatelink.azurewebsites.net"

# ---- 0. Login & subscription ----
az login
az account set --subscription $SUB

# ---- 1. Resource group ----
az group create --name $RG --location $LOC

# ============================================================
#  2. Subnets on the EXISTING VNet (do NOT create the VNet)
# ============================================================
# 2a. Integration subnet — delegated to App Service, min /27
az network vnet subnet create `
  --resource-group $RG --vnet-name $VNET --name $SNETIN `
  --address-prefixes 10.20.1.0/27 `
  --delegations Microsoft.Web/serverFarms

# 2b. Private-endpoint subnet — min /27, PE network policies disabled
az network vnet subnet create `
  --resource-group $RG --vnet-name $VNET --name $SNETPE `
  --address-prefixes 10.20.2.0/27 `
  --disable-private-endpoint-network-policies true

# NOTE: adjust the two prefixes above to free ranges inside the existing VNet.
$SNETIN_ID = az network vnet subnet show -g $RG --vnet-name $VNET -n $SNETIN --query id -o tsv
$SNETPE_ID = az network vnet subnet show -g $RG --vnet-name $VNET -n $SNETPE --query id -o tsv

# ============================================================
#  3. Private DNS zones (created up front so PEs resolve privately)
# ============================================================
az network private-dns zone create -g $RG -n $DNS_FILE
az network private-dns zone create -g $RG -n $DNS_SITE

# Link both zones to the existing VNet
$VNET_ID = az network vnet show -g $RG -n $VNET --query id -o tsv
az network private-dns link vnet create -g $RG --zone-name $DNS_FILE `
  --name "link-file" --virtual-network $VNET_ID --registration-enabled false
az network private-dns link vnet create -g $RG --zone-name $DNS_SITE `
  --name "link-site" --virtual-network $VNET_ID --registration-enabled false

# ============================================================
#  4. Storage account — PRIVATE FROM CREATION
# ============================================================
# Public access disabled and default network action Deny at creation time,
# so the DGE "no public endpoint" policy is satisfied from inception.
az storage account create `
  --name $STG --resource-group $RG --location $LOC `
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 `
  --allow-blob-public-access false `
  --public-network-access Disabled `
  --default-action Deny

# 4a. File share via the CONTROL plane (works even with data-plane public access off)
az storage share-rm create `
  --resource-group $RG --storage-account $STG --name $SHARE --quota 100

# 4b. Private endpoint for Azure Files (sub-resource: file)
$STG_ID = az storage account show -g $RG -n $STG --query id -o tsv
az network private-endpoint create `
  --resource-group $RG --name "pe-$STG-file" --location $LOC `
  --subnet $SNETPE_ID `
  --private-connection-resource-id $STG_ID `
  --group-id file --connection-name "conn-$STG-file"

# 4c. Wire the file PE into its private DNS zone
az network private-endpoint dns-zone-group create `
  --resource-group $RG --endpoint-name "pe-$STG-file" `
  --name "zg-file" --private-dns-zone $DNS_FILE --zone-name file

# ============================================================
#  5. App Service plan — Linux, S1 (B1 does NOT support VNet
#     integration or private endpoints; Standard is the minimum)
# ============================================================
az appservice plan create `
  --name $PLAN --resource-group $RG --location $LOC `
  --is-linux --sku S1

# ============================================================
#  6. Web App — created PRIVATE FROM INCEPTION
# ============================================================
# Create the app on the existing plan, then immediately disable public
# network access and force HTTPS BEFORE any code/traffic reaches it.
az webapp create `
  --resource-group $RG --plan $PLAN --name $APP `
  --runtime "NODE:20-lts"

az webapp update -g $RG -n $APP --set publicNetworkAccess=Disabled
az webapp update -g $RG -n $APP --https-only true

# 6a. Regional VNet integration (outbound → private storage)
az webapp vnet-integration add `
  --resource-group $RG --name $APP `
  --vnet $VNET --subnet $SNETIN

# 6b. Route ALL outbound through the VNet so storage is reached privately
az webapp config appsettings set -g $RG -n $APP `
  --settings WEBSITE_VNET_ROUTE_ALL=1

# ============================================================
#  7. Mount the Azure Files share into the app (BYOS)
# ============================================================
# Storage key retrieved over the control plane; mount traffic flows over
# the private endpoint created in step 4. (If DGE policy blocks shared-key
# access, switch this to an identity-based mount instead.)
$STG_KEY = az storage account keys list -g $RG -n $STG --query "[0].value" -o tsv
az webapp config storage-account add `
  --resource-group $RG --name $APP `
  --custom-id "dataroot" --storage-type AzureFiles `
  --account-name $STG --share-name $SHARE `
  --access-key $STG_KEY --mount-path "/mounts/data-root"

# ============================================================
#  8. Private endpoint for the Web App (sub-resource: sites)
# ============================================================
$APP_ID = az webapp show -g $RG -n $APP --query id -o tsv
az network private-endpoint create `
  --resource-group $RG --name "pe-$APP-sites" --location $LOC `
  --subnet $SNETPE_ID `
  --private-connection-resource-id $APP_ID `
  --group-id sites --connection-name "conn-$APP-sites"

az network private-endpoint dns-zone-group create `
  --resource-group $RG --endpoint-name "pe-$APP-sites" `
  --name "zg-sites" --private-dns-zone $DNS_SITE --zone-name sites

# ============================================================
#  9. Entra ID sign-in (Easy Auth)
# ============================================================
# Registers the app and requires interactive sign-in for all requests.
az webapp auth microsoft update `
  --resource-group $RG --name $APP `
  --client-id (az ad app create --display-name $APP --query appId -o tsv) `
  --issuer "https://login.microsoftonline.com/$(az account show --query tenantId -o tsv)/v2.0"
az webapp auth update -g $RG -n $APP `
  --enabled true --action RequireAuthentication --redirect-provider azureactivedirectory

# NOTE: restrict sign-in to the "$VIEWERGROUP" Entra group by assigning that
# group to the app registration's Enterprise App (Users & groups) and setting
# "Assignment required = Yes". Group-gating isn't exposed cleanly in az CLI.

# ============================================================
#  10. Deploy the application code with `az webapp up`
# ============================================================
# The app already exists and is locked to private access, so `webapp up`
# just packages $PROJ and deploys it — it does NOT re-open public access.
# IMPORTANT: because public network access is disabled, run this step from a
# host with private-line reach to the SCM endpoint (a jumpbox / self-hosted
# agent inside — or peered to — $VNET). SCM basic auth must be enabled.
Push-Location $PROJ
az webapp up `
  --name $APP --resource-group $RG --plan $PLAN `
  --location $LOC --runtime "NODE:20-lts" --sku S1
Pop-Location

Write-Host "Done. App '$APP' deployed privately. Copy CSVs from '$DATASRC' into the '$SHARE' file share." -ForegroundColor Green
