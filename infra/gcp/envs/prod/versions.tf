terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
  backend "gcs" {
    bucket = "agamim-catalog-prod-il-tfstate"
    prefix = "prod/site"
  }
}

# Credentials come from the environment (GOOGLE_OAUTH_ACCESS_TOKEN locally, Workload Identity Federation in CI).
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
