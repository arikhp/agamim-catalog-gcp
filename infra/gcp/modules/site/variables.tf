variable "project_id" { type = string }

variable "name" {
  type        = string
  description = "Short prefix for resource names, for example agamim-catalog"
}

variable "region" {
  type        = string
  description = "Bucket location. Israel (Tel Aviv) is me-west1."
}

variable "domain" {
  type        = string
  default     = ""
  description = "Public host name. Empty uses a free <ip>.sslip.io name derived from the reserved IP."
}

variable "deployer_service_account" {
  type        = string
  description = "Email of the service account that releases the site (write access to the bucket)."
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Where uptime alerts are sent. Empty creates no notification channel."
}
