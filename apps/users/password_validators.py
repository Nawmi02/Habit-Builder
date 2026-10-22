from django.core.exceptions import ValidationError


class LetterAndNumberPasswordValidator:
    """Require at least one ASCII letter and one digit in a password."""

    message = "Password must contain at least one letter and one number."

    def validate(self, password, user=None):
        if not any(character.isalpha() for character in password) or not any(
            character.isdigit() for character in password
        ):
            raise ValidationError(self.message, code="password_letter_number")

    def get_help_text(self):
        return self.message
