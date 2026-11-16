# Public consumer site: Cloud Storage bucket -> backend bucket (Cloud CDN) -> global external HTTPS load balancer.

locals {
  domain = var.domain != "" ? var.domain : "${replace(google_compute_global_address.site.address, ".", "-")}.sslip.io"
}

# ---------- Bucket ----------
resource "google_storage_bucket" "site" {
  name                        = "${var.project_id}-site"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning { enabled = true } # rollback = restore the previous generation

  website {
    main_page_suffix = "index.html"
    not_found_page   = "404.html"
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 5
      with_state         = "ARCHIVED"
    }
    action { type = "Delete" }
  }
}

# The CDN reads the bucket anonymously. The site is public by decision (mock data, no login).
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.site.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_iam_member" "deployer_write" {
  bucket = google_storage_bucket.site.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.deployer_service_account}"
}

# The deployer may only invalidate the CDN cache, nothing else on the load balancer.
resource "google_project_iam_custom_role" "cdn_invalidate" {
  project     = var.project_id
  role_id     = "cdnCacheInvalidator"
  title       = "CDN cache invalidator"
  description = "Invalidate Cloud CDN cache for the site URL map"
  permissions = ["compute.urlMaps.invalidateCache", "compute.urlMaps.get"]
}

resource "google_project_iam_member" "deployer_invalidate" {
  project = var.project_id
  role    = google_project_iam_custom_role.cdn_invalidate.id
  member  = "serviceAccount:${var.deployer_service_account}"
}

# ---------- Address, certificate ----------
resource "google_compute_global_address" "site" {
  name    = "${var.name}-ip"
  project = var.project_id
}

resource "google_compute_managed_ssl_certificate" "site" {
  name    = "${var.name}-cert"
  project = var.project_id
  managed { domains = [local.domain] }

  lifecycle { create_before_destroy = true }
}

# Cloud Armor is not used: a backend bucket only supports an edge policy, and this account's security-policy
# quota is 0. Revisit when the API sits behind the load balancer (WAF rules apply there).

# ---------- CDN + load balancer ----------
resource "google_compute_backend_bucket" "site" {
  name             = "${var.name}-site"
  project          = var.project_id
  bucket_name      = google_storage_bucket.site.name
  enable_cdn       = true
  compression_mode = "AUTOMATIC"

  cdn_policy {
    cache_mode        = "USE_ORIGIN_HEADERS" # the release workflow sets Cache-Control per file type
    negative_caching  = true
    serve_while_stale = 86400
  }
}

resource "google_compute_url_map" "site" {
  name            = var.name
  project         = var.project_id
  default_service = google_compute_backend_bucket.site.id
}

resource "google_compute_target_https_proxy" "site" {
  name             = "${var.name}-https"
  project          = var.project_id
  url_map          = google_compute_url_map.site.id
  ssl_certificates = [google_compute_managed_ssl_certificate.site.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${var.name}-https"
  project               = var.project_id
  target                = google_compute_target_https_proxy.site.id
  ip_address            = google_compute_global_address.site.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# Port 80 only redirects to HTTPS.
resource "google_compute_url_map" "redirect" {
  name    = "${var.name}-redirect"
  project = var.project_id
  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "${var.name}-http"
  project = var.project_id
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "${var.name}-http"
  project               = var.project_id
  target                = google_compute_target_http_proxy.redirect.id
  ip_address            = google_compute_global_address.site.id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# ---------- Monitoring ----------
resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "Catalog alerts"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

resource "google_monitoring_uptime_check_config" "site" {
  project      = var.project_id
  display_name = "${var.name}-site"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path           = "/"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type   = "uptime_url"
    labels = { project_id = var.project_id, host = local.domain }
  }
}

resource "google_monitoring_alert_policy" "down" {
  project      = var.project_id
  display_name = "Catalog site is down"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.site.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.project_id"]
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]
}
