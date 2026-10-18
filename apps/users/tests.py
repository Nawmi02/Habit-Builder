"""
Tests for ER entity 13: DEVICE_TOKEN.

Run:  python manage.py test apps.users
"""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from . import services
from .models import DeviceToken

User = get_user_model()


class DeviceTokenApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="a@x.com", password="pass12345", name="A")
        self.other = User.objects.create_user(email="b@x.com", password="pass12345", name="B")
        self.client.force_authenticate(self.user)

    def test_register_new_token(self):
        res = self.client.post("/api/devices/", {"push_token": "tok-1", "platform": "ANDROID"})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["push_token"], "tok-1")
        self.assertEqual(res.data["user_id"], self.user.pk)

    def test_register_same_token_again_updates(self):
        self.client.post("/api/devices/", {"push_token": "tok-1", "platform": "ANDROID"})
        res = self.client.post("/api/devices/", {"push_token": "tok-1", "platform": "ANDROID"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(DeviceToken.objects.filter(push_token="tok-1").count(), 1)

    def test_token_moves_to_new_account_on_same_phone(self):
        DeviceToken.objects.create(user=self.other, push_token="tok-1", platform="IOS")
        self.client.post("/api/devices/", {"push_token": "tok-1", "platform": "IOS"})
        self.assertEqual(DeviceToken.objects.get(push_token="tok-1").user, self.user)

    def test_invalid_platform_rejected(self):
        res = self.client.post("/api/devices/", {"push_token": "tok-1", "platform": "NOKIA"})
        self.assertEqual(res.status_code, 400)

    def test_list_only_mine(self):
        DeviceToken.objects.create(user=self.user, push_token="mine", platform="ANDROID")
        DeviceToken.objects.create(user=self.other, push_token="theirs", platform="ANDROID")
        res = self.client.get("/api/devices/")
        self.assertEqual([d["push_token"] for d in res.data], ["mine"])

    def test_delete_by_id(self):
        device = DeviceToken.objects.create(user=self.user, push_token="mine", platform="ANDROID")
        res = self.client.delete(f"/api/devices/{device.pk}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(DeviceToken.objects.filter(pk=device.pk).exists())

    def test_cannot_delete_other_users_device(self):
        device = DeviceToken.objects.create(user=self.other, push_token="theirs", platform="ANDROID")
        res = self.client.delete(f"/api/devices/{device.pk}/")
        self.assertEqual(res.status_code, 404)

    def test_unregister_by_token(self):
        DeviceToken.objects.create(user=self.user, push_token="mine", platform="ANDROID")
        res = self.client.post("/api/devices/unregister/", {"push_token": "mine"})
        self.assertEqual(res.status_code, 204)
        self.assertFalse(DeviceToken.objects.filter(push_token="mine").exists())

    def test_get_push_tokens_respects_notification_setting(self):
        DeviceToken.objects.create(user=self.user, push_token="mine", platform="ANDROID")
        self.assertEqual(services.get_push_tokens(self.user), ["mine"])
        self.user.notifications_enabled = False
        self.user.save()
        self.assertEqual(services.get_push_tokens(self.user), [])
