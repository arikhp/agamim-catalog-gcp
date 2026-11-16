variable "project_id" {
  type    = string
  default = "agamim-catalog-prod-il"
}

# Israel (Tel Aviv).
variable "region" {
  type    = string
  default = "me-west1"
}

variable "domain" {
  type    = string
  default = ""
}

variable "alert_email" {
  type    = string
  default = ""
}
