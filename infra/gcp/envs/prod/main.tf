module "site" {
  source = "../../modules/site"

  project_id               = var.project_id
  name                     = "agamim-catalog"
  region                   = var.region
  domain                   = var.domain
  alert_email              = var.alert_email
  deployer_service_account = "gh-site-deployer@${var.project_id}.iam.gserviceaccount.com"
}
